"""Safe, non-blocking runtime management for the public IERS EOP C01 file.

The IERS ``EOP_C01_IAU2000_1846-now.txt`` product is *not* a C04 file.  In
particular, its ``UT1-TAI`` column must be converted with the locally pinned
``TAI-UTC`` table before it can be used by Orbit's frame service.  This module
keeps that distinction explicit and performs all network I/O outside of state
transformations.

The cache is deliberately mutable operational data, whereas a configured
``ORBIT_EOP_C04_PATH`` remains an explicit, reproducible deployment choice.
Product-bound SP3 ERP snapshots continue to use their own isolated provider.
"""

from __future__ import annotations

import bisect
import datetime
import hashlib
import logging
import math
import os
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .eop import (
    ARCSECOND_TO_RADIAN,
    IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS,
    EarthOrientation,
    EarthOrientationCoverageError,
    EarthOrientationProvider,
    EopSnapshotIdentity,
    EopSnapshotValidationError,
    TabularEarthOrientationProvider,
    VisualApproximationEarthOrientationProvider,
)
from .scales import LeapSecondTable, default_leap_second_table, ensure_utc, utc_now

LOGGER = logging.getLogger(__name__)

IERS_EOP_C01_URL = "https://datacenter.iers.org/data/latestVersion/EOP_C01_IAU2000_1846-now.txt"
IERS_EOP_C01_FILENAME = "EOP_C01_IAU2000_1846-now.txt"
IERS_EOP_C01_SOURCE = f"IERS ({IERS_EOP_C01_FILENAME})"
IERS_EOP_C01_REFRESH_AGE = datetime.timedelta(days=7)
IERS_EOP_C01_DOWNLOAD_TIMEOUT_SECONDS = 20.0
IERS_EOP_C01_MAX_BYTES = 16 * 1024 * 1024
# The IERS Rapid Service/Prediction Centre publishes this exact canonical
# mirror from the IERS Data Center.  It contains Bulletin A rapid values and
# predictions, plus Bulletin B final values where they are available.  Do not
# silently use the USNO mirror here: the automatic product must stay pinned to
# an IERS HTTPS endpoint so its provenance is stable for operators.
IERS_FINALS2000A_URL = "https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all"
IERS_FINALS2000A_FILENAME = "finals2000A.all"
IERS_FINALS2000A_SOURCE = f"IERS ({IERS_FINALS2000A_FILENAME})"
IERS_FINALS2000A_REFRESH_AGE = datetime.timedelta(days=7)
IERS_FINALS2000A_DOWNLOAD_TIMEOUT_SECONDS = 20.0
IERS_FINALS2000A_MAX_BYTES = 16 * 1024 * 1024
# A linear tail is an explicitly degraded operational aid, never an IERS
# product.  It is deliberately short: pole/UT1 trends are not reliable for an
# arbitrary future mission window after Bulletin A predictions end.
IERS_LINEAR_EXTRAPOLATION_MAX_HORIZON = datetime.timedelta(days=30)
IERS_C01_MAX_ABS_CELESTIAL_POLE_ARCSECONDS = 0.1
IERS_C01_MAX_ABS_DUT1_SECONDS = 1.0
# Operational C01 values are normally around 1 ms (the fixture/current value
# is 0.711 ms), but the plausibility fence intentionally remains 10 ms so a
# legitimate IERS historical/combined row is not rejected as corruption.
IERS_C01_MAX_ABS_LOD_SECONDS = 0.010
# A daily IERS combined solution changes DUT1 by milliseconds, not tenths of a
# second.  The deliberately generous limit catches shifted/misinterpreted
# columns while allowing a partial or sub-daily table.
IERS_C01_MAX_UT1_TAI_CHANGE_SECONDS_PER_DAY = 0.1
_MJD_EPOCH = datetime.datetime(1858, 11, 17, tzinfo=datetime.UTC)
_C01_LOD_COLUMN = 21
_C01_REQUIRED_COLUMNS = _C01_LOD_COLUMN + 1
_C01_UT1_TAI_SENTINEL = 99.99

EopStatus = Literal["ok", "warning", "error"]
DownloadFetcher = Callable[[str, float, int], bytes]


class _RejectRedirects(HTTPRedirectHandler):
    """Keep the automatic snapshot pinned to its documented IERS URL."""

    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):  # type: ignore[no-untyped-def]
        raise OSError("La descarga automÃ¡tica EOP no admite redirecciones")


def _iso(value: datetime.datetime | None) -> str | None:
    return ensure_utc(value).isoformat() if value is not None else None


def _mjd_to_utc(mjd: float) -> datetime.datetime:
    if not math.isfinite(mjd):
        raise EopSnapshotValidationError("El MJD EOP C01 no es válido")
    try:
        return _MJD_EPOCH + datetime.timedelta(days=mjd)
    except OverflowError as exc:
        raise EopSnapshotValidationError("El MJD EOP C01 está fuera de rango") from exc


def _header_has_required_c01_columns(lines: list[str]) -> bool:
    """Recognise the documented C01 heading without guessing a C04 layout."""

    header = " ".join(lines).lower()
    normalized = "".join(character for character in header if character.isalnum())
    # The product has a stable title and a machine-readable column heading.
    # ``pm-x`` / ``pm-y`` become pmx/pmy after normalisation.
    return (
        "combearthrotationdata" in normalized
        and "mjd" in normalized
        and "pmx" in normalized
        and "pmy" in normalized
        and "ut1tai" in normalized
        and "dx" in normalized
        and "dy" in normalized
        and "lod" in normalized
    )


def _finite_c01_number(value: str, *, line_number: int, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise EopSnapshotValidationError(
            f"El valor {label} EOP C01 de la línea {line_number} no es numérico"
        ) from exc
    if not math.isfinite(result):
        raise EopSnapshotValidationError(
            f"El valor {label} EOP C01 de la línea {line_number} no es finito"
        )
    return result


def _validate_c01_physical_ranges(
    *,
    xp_arcseconds: float,
    yp_arcseconds: float,
    dut1_seconds: float,
    lod_seconds: float,
    dx_arcseconds: float,
    dy_arcseconds: float,
    line_number: int,
    product: str = "C01",
) -> None:
    """Reject values that could rotate a terrestrial orbit by kilometres."""

    values = {
        "PM-X": (xp_arcseconds, IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS, "arcsec"),
        "PM-Y": (yp_arcseconds, IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS, "arcsec"),
        # A C01 table spanning a positive UTC leap may legitimately show a
        # near-one-second DUT1 representation discontinuity after converting
        # its continuous UT1-TAI column. This is wider than the tighter ERP
        # import envelope, but still rejects shifted/minute-scale values.
        "UT1-UTC": (dut1_seconds, IERS_C01_MAX_ABS_DUT1_SECONDS, "s"),
        "LOD": (lod_seconds, IERS_C01_MAX_ABS_LOD_SECONDS, "s"),
        "dX": (dx_arcseconds, IERS_C01_MAX_ABS_CELESTIAL_POLE_ARCSECONDS, "arcsec"),
        "dY": (dy_arcseconds, IERS_C01_MAX_ABS_CELESTIAL_POLE_ARCSECONDS, "arcsec"),
    }
    for label, (value, limit, unit) in values.items():
        if abs(value) > limit:
            raise EopSnapshotValidationError(
                f"{label} EOP {product} fuera del rango físico ±{limit:g} {unit} en la línea {line_number}"
            )


class IersC01EarthOrientationProvider(TabularEarthOrientationProvider):
    """Immutable provider parsed from IERS ``EOP_C01_IAU2000``.

    C01 rows start with ``MJD`` and use these zero-based positions:

    ``0=MJD, 1=PM-X, 2=PM-Y, 3=UT1-TAI, 4=dX, 5=dY, 21=LOD``.

    PM and celestial-pole quantities are published in arcseconds. LOD is
    already published in seconds (for example ``-0.000711`` is -0.711 ms).
    The historical
    pre-1972 rows and the documented ``UT1-TAI=99.99`` sentinel are excluded:
    Orbit's modern UTC/TAI table must never be extrapolated backwards merely
    to claim artificial EOP coverage.
    """

    @property
    def snapshot_identity(self) -> EopSnapshotIdentity | None:
        """Return immutable identity/coverage when bytes came from a snapshot."""

        return getattr(self, "_snapshot_identity", None)

    @classmethod
    def from_text(
        cls,
        text: str,
        *,
        leap_seconds: LeapSecondTable | None = None,
        source: str = IERS_EOP_C01_SOURCE,
        version: str | None = IERS_EOP_C01_FILENAME,
        quality: str = "final",
        allow_extrapolation: bool = False,
        require_header: bool = True,
        snapshot_id: str | None = None,
    ) -> IersC01EarthOrientationProvider:
        """Parse a C01 text snapshot and convert ``UT1-TAI`` to ``DUT1``."""

        table = leap_seconds or default_leap_second_table()
        if not isinstance(table, LeapSecondTable):
            raise TypeError("leap_seconds debe ser una LeapSecondTable o None")
        all_lines = str(text).splitlines()
        if not str(text).strip():
            raise EopSnapshotValidationError("El snapshot EOP C01 no puede estar vacío")
        header_lines: list[str] = []
        samples: list[EarthOrientation] = []
        previous_epoch: datetime.datetime | None = None
        previous_ut1_tai: float | None = None
        earliest_modern_utc = table.entries[0][0]

        for line_number, raw in enumerate(all_lines, start=1):
            stripped = raw.strip()
            if not stripped:
                continue
            fields = stripped.split()
            try:
                float(fields[0])
            except (IndexError, ValueError):
                header_lines.append(stripped)
                continue
            mjd = _finite_c01_number(fields[0], line_number=line_number, label="MJD")
            epoch = _mjd_to_utc(mjd)
            # C01 intentionally preserves historical rows for which the
            # modern UTC/TAI scale has no defined conversion in Orbit.
            if epoch < earliest_modern_utc:
                continue
            if len(fields) < _C01_REQUIRED_COLUMNS:
                raise EopSnapshotValidationError(
                    f"La línea {line_number} EOP C01 no contiene las {_C01_REQUIRED_COLUMNS} columnas requeridas"
                )
            ut1_tai = _finite_c01_number(fields[3], line_number=line_number, label="UT1-TAI")
            if math.isclose(ut1_tai, _C01_UT1_TAI_SENTINEL, rel_tol=0.0, abs_tol=1e-9):
                continue
            xp = _finite_c01_number(fields[1], line_number=line_number, label="PM-X")
            yp = _finite_c01_number(fields[2], line_number=line_number, label="PM-Y")
            dx = _finite_c01_number(fields[4], line_number=line_number, label="dX")
            dy = _finite_c01_number(fields[5], line_number=line_number, label="dY")
            lod_seconds = _finite_c01_number(
                fields[_C01_LOD_COLUMN], line_number=line_number, label="LOD"
            )
            try:
                dut1 = ut1_tai + table.tai_minus_utc(epoch)
            except ValueError as exc:
                raise EopSnapshotValidationError(
                    f"No hay TAI-UTC local para convertir UT1-TAI en la línea {line_number}"
                ) from exc
            _validate_c01_physical_ranges(
                xp_arcseconds=xp,
                yp_arcseconds=yp,
                dut1_seconds=dut1,
                lod_seconds=lod_seconds,
                dx_arcseconds=dx,
                dy_arcseconds=dy,
                line_number=line_number,
            )
            sample = EarthOrientation(
                dut1_seconds=dut1,
                xp_radians=xp * ARCSECOND_TO_RADIAN,
                yp_radians=yp * ARCSECOND_TO_RADIAN,
                dx_radians=dx * ARCSECOND_TO_RADIAN,
                dy_radians=dy * ARCSECOND_TO_RADIAN,
                lod_seconds=lod_seconds,
                source=source,
                version=version,
                quality=quality,
                sampled_at=epoch,
                snapshot_id=snapshot_id,
            )
            if previous_epoch is not None and previous_ut1_tai is not None:
                if sample.sampled_at is None or sample.sampled_at <= previous_epoch:
                    raise EopSnapshotValidationError(
                        f"El snapshot EOP C01 debe estar ordenado sin MJD repetidos (línea {line_number})"
                    )
                elapsed_days = (sample.sampled_at - previous_epoch).total_seconds() / 86_400.0
                maximum_change = IERS_C01_MAX_UT1_TAI_CHANGE_SECONDS_PER_DAY * max(elapsed_days, 1.0)
                # DUT1 itself jumps at a positive leap second because UTC
                # changes by a second. UT1-TAI is the continuous C01
                # quantity, so validate that instead of rejecting a valid
                # table crossing a known TAI-UTC change.
                if abs(ut1_tai - previous_ut1_tai) > maximum_change:
                    raise EopSnapshotValidationError(
                        f"UT1-TAI EOP C01 presenta un salto no físico en la línea {line_number}"
                    )
            samples.append(sample)
            previous_epoch = epoch
            previous_ut1_tai = ut1_tai

        if require_header and not _header_has_required_c01_columns(header_lines):
            raise EopSnapshotValidationError(
                "El snapshot EOP C01 no declara el encabezado COMB EARTH ROTATION DATA "
                "con MJD, PM-X, PM-Y, UT1-TAI, dX, dY y LOD"
            )
        if not samples:
            raise EopSnapshotValidationError(
                "El snapshot EOP C01 no contiene registros modernos utilizables con la tabla TAI-UTC local"
            )
        return cls(samples, allow_extrapolation=allow_extrapolation)

    @classmethod
    def from_bytes(
        cls,
        raw: bytes,
        *,
        filename: str = IERS_EOP_C01_FILENAME,
        leap_seconds: LeapSecondTable | None = None,
        source: str = IERS_EOP_C01_SOURCE,
        version: str | None = None,
        quality: str = "final",
        allow_extrapolation: bool = False,
        require_header: bool = True,
    ) -> IersC01EarthOrientationProvider:
        """Parse bytes and attach a content hash before they become active."""

        if not raw:
            raise EopSnapshotValidationError("El snapshot EOP C01 no puede estar vacío")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise EopSnapshotValidationError("El snapshot EOP C01 debe estar codificado en UTF-8/ASCII") from exc
        digest = hashlib.sha256(raw).hexdigest()
        provider = cls.from_text(
            text,
            leap_seconds=leap_seconds,
            source=source,
            version=version or filename,
            quality=quality,
            allow_extrapolation=allow_extrapolation,
            require_header=require_header,
            snapshot_id=f"sha256:{digest}",
        )
        first, last = provider.samples[0], provider.samples[-1]
        assert first.sampled_at is not None and last.sampled_at is not None
        provider._snapshot_identity = EopSnapshotIdentity(
            filename=filename,
            sha256=digest,
            byte_size=len(raw),
            record_count=len(provider.samples),
            coverage_start=first.sampled_at,
            coverage_end=last.sampled_at,
        )
        return provider

    @classmethod
    def from_file(
        cls,
        path: str | Path,
        **kwargs: object,
    ) -> IersC01EarthOrientationProvider:
        """Read only a local C01 snapshot; this method never performs I/O over HTTP."""

        source_path = Path(path)
        try:
            raw = source_path.read_bytes()
        except OSError as exc:
            raise EopSnapshotValidationError(f"No se puede leer el snapshot EOP C01 local: {source_path}") from exc
        return cls.from_bytes(raw, filename=source_path.name, **kwargs)


class IersFinals2000AEarthOrientationProvider(TabularEarthOrientationProvider):
    """Immutable provider parsed from official IERS ``finals2000A.all``.

    The standard rapid file uses a fixed-width layout documented by the IERS
    Rapid Service/Prediction Centre.  Bulletin B values are selected only when
    the complete EOP tuple is present (``final``).  Otherwise, the parser uses
    the Bulletin A tuple and preserves its per-quantity ``I``/``P`` flags as
    ``rapid`` or ``predicted`` quality.  LOD is optional in the source and is
    therefore never invented when its field is blank.

    This matters at the final/rapid boundary: a calendar date in the file is
    not automatically a final IERS solution, and a prediction must never be
    relabelled as one merely because the file itself is named ``finals``.
    """

    _BULLETIN_A_FLAGS = frozenset({"I", "P"})
    _CONTIGUOUS_DAILY_GAP = datetime.timedelta(days=1, seconds=1)

    @property
    def snapshot_identity(self) -> EopSnapshotIdentity | None:
        """Return immutable identity/coverage when bytes came from a snapshot."""

        return getattr(self, "_snapshot_identity", None)

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        """Interpolate values while retaining the conservative source quality.

        A quality boundary may occur between two daily samples.  The generic
        tabular provider correctly interpolates the numerical fields but calls
        the mixed row ``interpolated``; for operations the important fact is
        whether either neighbour is predicted/rapid.  Preserve the worse of
        the two official qualities rather than hiding that transition.
        """

        orientation = super().at(moment)
        if orientation.quality != "interpolated":
            return orientation
        instant = ensure_utc(moment)
        index = bisect.bisect_left(self._timestamps, instant)
        if index <= 0 or index >= len(self.samples):
            return orientation
        lower, upper = self.samples[index - 1], self.samples[index]
        rank = {"final": 0, "rapid": 1, "predicted": 2}
        quality = max((lower.quality, upper.quality), key=lambda item: rank.get(item, 3))
        return EarthOrientation(
            dut1_seconds=orientation.dut1_seconds,
            xp_radians=orientation.xp_radians,
            yp_radians=orientation.yp_radians,
            dx_radians=orientation.dx_radians,
            dy_radians=orientation.dy_radians,
            lod_seconds=orientation.lod_seconds,
            source=orientation.source,
            version=orientation.version,
            quality=quality,
            sampled_at=orientation.sampled_at,
            snapshot_id=orientation.snapshot_id,
        )

    @property
    def quality_segments(self) -> tuple[tuple[str, datetime.datetime, datetime.datetime], ...]:
        """Return contiguous daily quality sections for planner diagnostics."""

        segments: list[tuple[str, datetime.datetime, datetime.datetime]] = []
        quality: str | None = None
        start: datetime.datetime | None = None
        previous: datetime.datetime | None = None
        for sample in self.samples:
            assert sample.sampled_at is not None
            if (
                quality is None
                or sample.quality != quality
                or previous is None
                or sample.sampled_at - previous > self._CONTIGUOUS_DAILY_GAP
            ):
                if quality is not None and start is not None and previous is not None:
                    segments.append((quality, start, previous))
                quality = sample.quality
                start = sample.sampled_at
            previous = sample.sampled_at
        if quality is not None and start is not None and previous is not None:
            segments.append((quality, start, previous))
        return tuple(segments)

    @staticmethod
    def _slice(raw: str, first: int, last: int) -> str:
        """Read a one-based inclusive fixed-width field without shifting it."""

        return raw[first - 1:last].strip()

    @classmethod
    def _number(
        cls,
        raw: str,
        first: int,
        last: int,
        *,
        line_number: int,
        label: str,
        required: bool = True,
    ) -> float | None:
        field = cls._slice(raw, first, last)
        if not field:
            if required:
                raise EopSnapshotValidationError(
                    f"El valor {label} EOP finals2000A de la línea {line_number} está vacío"
                )
            return None
        try:
            number = float(field)
        except ValueError as exc:
            raise EopSnapshotValidationError(
                f"El valor {label} EOP finals2000A de la línea {line_number} no es numérico"
            ) from exc
        if not math.isfinite(number):
            raise EopSnapshotValidationError(
                f"El valor {label} EOP finals2000A de la línea {line_number} no es finito"
            )
        return number

    @classmethod
    def _calendar_epoch(cls, raw: str, *, line_number: int, mjd: float) -> datetime.datetime:
        """Validate the calendar prefix against the documented UTC MJD field."""

        try:
            year_suffix = int(cls._slice(raw, 1, 2))
            month = int(cls._slice(raw, 3, 4))
            day = int(cls._slice(raw, 5, 6))
        except ValueError as exc:
            raise EopSnapshotValidationError(
                f"La fecha EOP finals2000A de la línea {line_number} no es válida"
            ) from exc
        year = year_suffix + (1900 if mjd <= 51543.0 else 2000)
        try:
            calendar_date = datetime.datetime(year, month, day, tzinfo=datetime.UTC)
        except ValueError as exc:
            raise EopSnapshotValidationError(
                f"La fecha EOP finals2000A de la línea {line_number} no es válida"
            ) from exc
        epoch = _mjd_to_utc(mjd)
        if calendar_date.date() != epoch.date():
            raise EopSnapshotValidationError(
                f"La fecha/MJD EOP finals2000A no coincide en la línea {line_number}"
            )
        return epoch

    @classmethod
    def from_text(
        cls,
        text: str,
        *,
        leap_seconds: LeapSecondTable | None = None,
        source: str = IERS_FINALS2000A_SOURCE,
        version: str | None = IERS_FINALS2000A_FILENAME,
        allow_extrapolation: bool = False,
        snapshot_id: str | None = None,
    ) -> IersFinals2000AEarthOrientationProvider:
        """Parse an IERS fixed-width rapid/final/predicted EOP snapshot."""

        # Keep the call shape compatible with C01.  finals2000A publishes
        # UT1-UTC directly, so it does not require a TAI-UTC conversion.
        del leap_seconds
        if not str(text).strip():
            raise EopSnapshotValidationError("El snapshot EOP finals2000A no puede estar vacío")
        samples: list[EarthOrientation] = []
        previous_epoch: datetime.datetime | None = None
        for line_number, raw in enumerate(str(text).splitlines(), start=1):
            if not raw.strip():
                continue
            # Data rows start with a two-digit year.  Do not use ``split``:
            # blank fixed-width fields (especially LOD) carry semantics.
            if len(raw) < 15 or not cls._slice(raw, 1, 2).isdigit():
                continue
            mjd = cls._number(raw, 8, 15, line_number=line_number, label="MJD")
            assert mjd is not None
            epoch = cls._calendar_epoch(raw, line_number=line_number, mjd=mjd)
            if previous_epoch is not None and epoch <= previous_epoch:
                raise EopSnapshotValidationError(
                    f"El snapshot EOP finals2000A debe estar ordenado sin MJD repetidos (línea {line_number})"
                )

            bulletin_b = (
                cls._number(raw, 135, 144, line_number=line_number, label="Bull. B PM-X", required=False),
                cls._number(raw, 145, 154, line_number=line_number, label="Bull. B PM-Y", required=False),
                cls._number(raw, 155, 165, line_number=line_number, label="Bull. B UT1-UTC", required=False),
                cls._number(raw, 166, 175, line_number=line_number, label="Bull. B dX", required=False),
                cls._number(raw, 176, 185, line_number=line_number, label="Bull. B dY", required=False),
            )
            lod_milliseconds = cls._number(
                raw, 80, 86, line_number=line_number, label="LOD", required=False
            )
            if all(value is not None for value in bulletin_b):
                xp, yp, dut1, dx_milliarcseconds, dy_milliarcseconds = bulletin_b
                quality = "final"
            else:
                pm_flag = cls._slice(raw, 17, 17).upper()
                ut1_flag = cls._slice(raw, 58, 58).upper()
                nutation_flag = cls._slice(raw, 96, 96).upper()
                flags = (pm_flag, ut1_flag, nutation_flag)
                if not all(flag in cls._BULLETIN_A_FLAGS for flag in flags):
                    # A partially populated line is common near source product
                    # boundaries.  It has no complete usable EOP tuple, so do
                    # not invent a value or falsely extend coverage.
                    continue
                xp = cls._number(raw, 19, 27, line_number=line_number, label="Bull. A PM-X")
                yp = cls._number(raw, 38, 46, line_number=line_number, label="Bull. A PM-Y")
                dut1 = cls._number(raw, 59, 68, line_number=line_number, label="Bull. A UT1-UTC")
                dx_milliarcseconds = cls._number(raw, 98, 106, line_number=line_number, label="Bull. A dX")
                dy_milliarcseconds = cls._number(raw, 117, 125, line_number=line_number, label="Bull. A dY")
                assert all(
                    value is not None
                    for value in (xp, yp, dut1, dx_milliarcseconds, dy_milliarcseconds)
                )
                quality = "predicted" if "P" in flags else "rapid"
            assert xp is not None and yp is not None and dut1 is not None
            assert dx_milliarcseconds is not None and dy_milliarcseconds is not None
            dx = dx_milliarcseconds / 1_000.0
            dy = dy_milliarcseconds / 1_000.0
            lod_seconds = None if lod_milliseconds is None else lod_milliseconds / 1_000.0
            _validate_c01_physical_ranges(
                xp_arcseconds=xp,
                yp_arcseconds=yp,
                dut1_seconds=dut1,
                lod_seconds=lod_seconds or 0.0,
                dx_arcseconds=dx,
                dy_arcseconds=dy,
                line_number=line_number,
                product="finals2000A",
            )
            samples.append(
                EarthOrientation(
                    dut1_seconds=dut1,
                    xp_radians=xp * ARCSECOND_TO_RADIAN,
                    yp_radians=yp * ARCSECOND_TO_RADIAN,
                    dx_radians=dx * ARCSECOND_TO_RADIAN,
                    dy_radians=dy * ARCSECOND_TO_RADIAN,
                    lod_seconds=lod_seconds,
                    source=source,
                    version=version,
                    quality=quality,
                    sampled_at=epoch,
                    snapshot_id=snapshot_id,
                )
            )
            previous_epoch = epoch
        if not samples:
            raise EopSnapshotValidationError(
                "El snapshot EOP finals2000A no contiene filas final/rapid/predicted utilizables"
            )
        return cls(samples, allow_extrapolation=allow_extrapolation)

    @classmethod
    def from_bytes(
        cls,
        raw: bytes,
        *,
        filename: str = IERS_FINALS2000A_FILENAME,
        leap_seconds: LeapSecondTable | None = None,
        source: str = IERS_FINALS2000A_SOURCE,
        version: str | None = None,
        allow_extrapolation: bool = False,
    ) -> IersFinals2000AEarthOrientationProvider:
        """Parse bytes and attach a hash before they become active."""

        if not raw:
            raise EopSnapshotValidationError("El snapshot EOP finals2000A no puede estar vacío")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise EopSnapshotValidationError(
                "El snapshot EOP finals2000A debe estar codificado en UTF-8/ASCII"
            ) from exc
        digest = hashlib.sha256(raw).hexdigest()
        provider = cls.from_text(
            text,
            leap_seconds=leap_seconds,
            source=source,
            version=version or filename,
            allow_extrapolation=allow_extrapolation,
            snapshot_id=f"sha256:{digest}",
        )
        first, last = provider.samples[0], provider.samples[-1]
        assert first.sampled_at is not None and last.sampled_at is not None
        provider._snapshot_identity = EopSnapshotIdentity(
            filename=filename,
            sha256=digest,
            byte_size=len(raw),
            record_count=len(provider.samples),
            coverage_start=first.sampled_at,
            coverage_end=last.sampled_at,
        )
        return provider

    @classmethod
    def from_file(
        cls,
        path: str | Path,
        **kwargs: object,
    ) -> IersFinals2000AEarthOrientationProvider:
        """Read only a local finals2000A snapshot; never contacts IERS."""

        source_path = Path(path)
        try:
            raw = source_path.read_bytes()
        except OSError as exc:
            raise EopSnapshotValidationError(
                f"No se puede leer el snapshot EOP finals2000A local: {source_path}"
            ) from exc
        return cls.from_bytes(raw, filename=source_path.name, **kwargs)


@dataclass(frozen=True, slots=True)
class EopCacheDiagnostics:
    """JSON-safe state of the automatic IERS cache, never a scientific claim."""

    status: EopStatus
    loaded: bool
    source: str
    source_url: str
    cache_file: str
    last_update: datetime.datetime | None = None
    last_validation: datetime.datetime | None = None
    coverage_start: datetime.datetime | None = None
    coverage_end: datetime.datetime | None = None
    record_count: int = 0
    error: str | None = None
    refresh_due: bool = True
    using_cached_fallback: bool = False
    automatic: bool = True
    # ``last_update`` describes the cached bytes, whereas the C01 table may
    # still end before the instant at which it was checked. Keep those two
    # facts separate: a recently downloaded historical C01 is not an old
    # cache, but it also must not be presented as EOP coverage for today.
    cache_fresh: bool | None = None
    coverage_current: bool | None = None
    refresh_reasons: tuple[str, ...] = ()
    # A composite automatic route keeps the legacy root fields above and
    # exposes every physical source separately below.  These are plain JSON
    # values so clients can render a timeline without inferring quality from a
    # human-readable error message.
    sources: dict[str, object] | None = None
    coverage_timeline: tuple[dict[str, object], ...] = ()
    selection: dict[str, object] | None = None
    format_name: str = "IERS EOP C01 IAU2000"

    def payload(self) -> dict[str, object]:
        """Return the stable ``/system/diagnostics`` ERP component contract."""

        coverage = (
            {"start": _iso(self.coverage_start), "end": _iso(self.coverage_end)}
            if self.coverage_start is not None and self.coverage_end is not None
            else None
        )
        return {
            "status": self.status,
            "loaded": self.loaded,
            "source": self.source,
            "sourceUrl": self.source_url,
            "cacheFile": self.cache_file,
            "lastUpdate": _iso(self.last_update),
            "lastValidation": _iso(self.last_validation),
            "coverage": coverage,
            "recordCount": self.record_count,
            "error": self.error,
            "refreshDue": self.refresh_due,
            "usingCachedFallback": self.using_cached_fallback,
            "automatic": self.automatic,
            "cacheFresh": self.cache_fresh,
            "coverageCurrent": self.coverage_current,
            "refreshReasons": list(self.refresh_reasons),
            "sources": self.sources or {},
            "coverageTimeline": list(self.coverage_timeline),
            "selection": self.selection,
            "validationLimits": {
                "polarMotionArcsec": IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS,
                "dut1Seconds": IERS_C01_MAX_ABS_DUT1_SECONDS,
                "lodSeconds": IERS_C01_MAX_ABS_LOD_SECONDS,
                "celestialPoleArcsec": IERS_C01_MAX_ABS_CELESTIAL_POLE_ARCSECONDS,
            },
            "details": {
                "format": self.format_name,
                "automatic": self.automatic,
                "usingCachedFallback": self.using_cached_fallback,
                "refreshDue": self.refresh_due,
                "cacheFresh": self.cache_fresh,
                "coverageCurrent": self.coverage_current,
                "refreshReasons": list(self.refresh_reasons),
                "sources": self.sources or {},
                "coverageTimeline": list(self.coverage_timeline),
                "selection": self.selection,
            },
        }


class IersEopCacheService(EarthOrientationProvider):
    """Thread-safe active generic IERS EOP provider backed by one cache file.

    ``at()`` only reads an immutable provider already installed in memory. It
    never checks freshness, opens the cache or contacts IERS; a background
    monitor calls :meth:`refresh_if_needed` instead. Replacing a validated
    provider is an atomic pointer swap protected by a lock.
    """

    def __init__(
        self,
        cache_path: str | Path,
        *,
        leap_seconds: LeapSecondTable | None = None,
        url: str = IERS_EOP_C01_URL,
        refresh_age: datetime.timedelta = IERS_EOP_C01_REFRESH_AGE,
        timeout_seconds: float = IERS_EOP_C01_DOWNLOAD_TIMEOUT_SECONDS,
        max_bytes: int = IERS_EOP_C01_MAX_BYTES,
        fetcher: DownloadFetcher | None = None,
        now: Callable[[], datetime.datetime] = utc_now,
    ) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("La URL EOP automática debe usar HTTPS")
        if refresh_age <= datetime.timedelta(0):
            raise ValueError("refresh_age debe ser positivo")
        try:
            timeout = float(timeout_seconds)
        except (TypeError, ValueError) as exc:
            raise ValueError("timeout_seconds debe estar entre 0.1 y 120 segundos") from exc
        if not math.isfinite(timeout) or not 0.1 <= timeout <= 120.0:
            raise ValueError("timeout_seconds debe estar entre 0.1 y 120 segundos")
        try:
            byte_limit = int(max_bytes)
        except (TypeError, ValueError) as exc:
            raise ValueError("max_bytes debe estar entre 1 KiB y 128 MiB") from exc
        if isinstance(max_bytes, bool) or byte_limit != max_bytes or not 1_024 <= byte_limit <= 128 * 1024 * 1024:
            raise ValueError("max_bytes debe estar entre 1 KiB y 128 MiB")
        table = leap_seconds or default_leap_second_table()
        if not isinstance(table, LeapSecondTable):
            raise TypeError("leap_seconds debe ser una LeapSecondTable o None")
        self.cache_path = Path(cache_path)
        self.url = url
        self.refresh_age = refresh_age
        self.timeout_seconds = timeout
        self.max_bytes = byte_limit
        self.leap_seconds = table
        self._fetcher = fetcher or self._download_https
        self._now = now
        self._state_lock = threading.RLock()
        self._refresh_lock = threading.Lock()
        self._provider: IersC01EarthOrientationProvider | None = None
        self._fallback = VisualApproximationEarthOrientationProvider()
        self._diagnostics = EopCacheDiagnostics(
            status="warning",
            loaded=False,
            source=IERS_EOP_C01_SOURCE,
            source_url=self.url,
            cache_file=self.cache_path.name,
            error="La carga automática de EOP todavía no se ha ejecutado.",
            refresh_due=True,
        )

    @property
    def active_provider(self) -> IersC01EarthOrientationProvider | None:
        """Return the immutable generic provider currently active, if any."""

        with self._state_lock:
            return self._provider

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        """Read active EOP or return an explicitly marked nominal fallback.

        C01 is an operational global source, not a promise of arbitrary
        historical/future coverage.  Manual Earth-fixed propagation may use
        the same process service, so an out-of-window epoch must degrade to
        the labelled nominal rotation rather than trigger a hidden download or
        demand a per-orbit ERP upload. Product-bound precise SP3 providers do
        not use this service and remain fail-closed outside their ERP window.
        """

        with self._state_lock:
            provider = self._provider
        if provider is None:
            return self._fallback.at(moment)
        try:
            return provider.at(moment)
        except EarthOrientationCoverageError:
            return self._fallback.at(moment)

    def diagnostics(self) -> EopCacheDiagnostics:
        """Read an immutable diagnostic snapshot without touching disk/network."""

        with self._state_lock:
            return self._diagnostics

    def diagnostics_payload(self) -> dict[str, object]:
        return self.diagnostics().payload()

    def refresh_if_needed(self) -> EopCacheDiagnostics:
        """Validate local cache and refresh it if missing, old or out of coverage.

        The previous valid in-memory provider stays active if a new download is
        rejected.  A malformed remote file is never written over the last good
        snapshot.  Concurrent monitor calls collapse to one refresh attempt.
        """

        if not self._refresh_lock.acquire(blocking=False):
            return self.diagnostics()
        try:
            now = ensure_utc(self._now())
            cached_provider, cached_update, cached_error = self._load_cached()
            fresh = (
                cached_provider is not None
                and cached_update is not None
                and self._is_fresh(cached_update, now)
            )
            coverage_current = (
                cached_provider is not None
                and self._covers(cached_provider, now)
            )
            refresh_reasons = self._refresh_reasons(
                cache_fresh=fresh if cached_provider is not None else None,
                coverage_current=coverage_current if cached_provider is not None else None,
            )
            if cached_provider is not None:
                self._install(
                    cached_provider,
                    last_update=cached_update,
                    last_validation=now,
                    status="ok" if fresh and coverage_current else "warning",
                    error=None if fresh else "El snapshot EOP local supera la antigüedad máxima de 7 días.",
                    refresh_due=bool(refresh_reasons),
                    using_cached_fallback=not fresh,
                    cache_fresh=fresh,
                    coverage_current=coverage_current,
                    refresh_reasons=refresh_reasons,
                )
            # C01 is a historical/combined IERS product. A recently written
            # cache can therefore still end before the UTC instant being
            # checked. Ask the canonical endpoint again in that case rather
            # than treating a file mtime as scientific coverage.
            if fresh and coverage_current:
                return self.diagnostics()

            try:
                raw = self._fetcher(self.url, self.timeout_seconds, self.max_bytes)
                if not isinstance(raw, bytes):
                    raise EopSnapshotValidationError("La descarga EOP no devolvió bytes")
                if not raw:
                    raise EopSnapshotValidationError("La descarga EOP está vacía")
                if len(raw) > self.max_bytes:
                    raise EopSnapshotValidationError("La descarga EOP supera el tamaño máximo permitido")
                provider = IersC01EarthOrientationProvider.from_bytes(
                    raw,
                    filename=self.cache_path.name or IERS_EOP_C01_FILENAME,
                    leap_seconds=self.leap_seconds,
                )
                self._write_atomically(raw)
                # mtime is read after the atomic replacement so diagnostics
                # describe the actual cache, not merely the worker clock.
                update = datetime.datetime.fromtimestamp(self.cache_path.stat().st_mtime, tz=datetime.UTC)
                refreshed_coverage_current = self._covers(provider, now)
                self._install(
                    provider,
                    last_update=update,
                    last_validation=now,
                    status="ok" if refreshed_coverage_current else "warning",
                    error=(
                        None
                        if refreshed_coverage_current
                        else (
                            "IERS C01 se actualizó y validó, pero la fuente publicada "
                            "no cubre el instante actual."
                        )
                    ),
                    refresh_due=not refreshed_coverage_current,
                    using_cached_fallback=False,
                    cache_fresh=True,
                    coverage_current=refreshed_coverage_current,
                    refresh_reasons=self._refresh_reasons(
                        cache_fresh=True,
                        coverage_current=refreshed_coverage_current,
                    ),
                )
                return self.diagnostics()
            except Exception as exc:  # noqa: BLE001 - transport/untrusted-content boundary
                message = self._safe_error(exc)
                if cached_provider is not None:
                    self._install(
                        cached_provider,
                        last_update=cached_update,
                        last_validation=now,
                        status="warning",
                        error=self._join_errors(
                            f"No se pudo actualizar EOP; se conserva la última copia válida: {message}",
                            (
                                None
                                if fresh
                                else "El snapshot EOP local supera la antigüedad máxima de 7 días."
                            ),
                        ),
                        refresh_due=True,
                        using_cached_fallback=True,
                        cache_fresh=fresh,
                        coverage_current=coverage_current,
                        refresh_reasons=refresh_reasons or ("cache",),
                    )
                else:
                    # A transport outage on first boot is a warning (the
                    # renderer may still use explicit nominal rotation). A
                    # syntactically invalid remote file is an error because
                    # it needs operator investigation, not a retry loop.
                    invalid_remote = isinstance(exc, EopSnapshotValidationError)
                    self._install_missing(
                        now,
                        status="error" if invalid_remote else "warning",
                        error=(
                            f"No hay una copia EOP válida disponible: {message}"
                            if cached_error is None
                            else f"No hay una copia EOP válida disponible ({cached_error}): {message}"
                        ),
                    )
                return self.diagnostics()
        finally:
            self._refresh_lock.release()

    def validate_cached(self) -> EopCacheDiagnostics:
        """Cheap local-only monitor check; it never starts a download."""

        now = ensure_utc(self._now())
        provider, update, error = self._load_cached()
        if provider is None:
            self._install_missing(now, status="warning", error=error or "No existe una copia EOP local válida.")
        else:
            fresh = self._is_fresh(update, now) if update is not None else False
            coverage_current = self._covers(provider, now)
            refresh_reasons = self._refresh_reasons(
                cache_fresh=fresh,
                coverage_current=coverage_current,
            )
            self._install(
                provider,
                last_update=update,
                last_validation=now,
                status="ok" if fresh and coverage_current else "warning",
                error=None if fresh else "El snapshot EOP local supera la antigüedad máxima de 7 días.",
                refresh_due=bool(refresh_reasons),
                using_cached_fallback=not fresh,
                cache_fresh=fresh,
                coverage_current=coverage_current,
                refresh_reasons=refresh_reasons,
            )
        return self.diagnostics()

    def _load_cached(
        self,
    ) -> tuple[IersC01EarthOrientationProvider | None, datetime.datetime | None, str | None]:
        try:
            metadata = self.cache_path.stat()
        except FileNotFoundError:
            return None, None, None
        except OSError as exc:
            return None, None, self._safe_error(exc)
        if metadata.st_size <= 0:
            return None, None, "El archivo EOP local está vacío."
        if metadata.st_size > self.max_bytes:
            return None, None, "El archivo EOP local supera el tamaño máximo permitido."
        try:
            provider = IersC01EarthOrientationProvider.from_file(
                self.cache_path,
                leap_seconds=self.leap_seconds,
            )
        except (OSError, ValueError) as exc:
            return None, None, self._safe_error(exc)
        update = datetime.datetime.fromtimestamp(metadata.st_mtime, tz=datetime.UTC)
        return provider, update, None

    def _is_fresh(self, update: datetime.datetime, now: datetime.datetime) -> bool:
        age = ensure_utc(now) - ensure_utc(update)
        # A future mtime is commonly a harmless host-clock skew. It is not
        # "older than seven days", so retain the validated local snapshot and
        # avoid replacing it with a network response merely because clocks
        # disagree. Diagnostics still report the actual update timestamp.
        return age <= self.refresh_age

    @staticmethod
    def _covers(provider: IersC01EarthOrientationProvider, moment: datetime.datetime) -> bool:
        """Whether the immutable C01 snapshot covers ``moment`` exactly."""

        identity = provider.snapshot_identity
        if identity is None:
            return False
        instant = ensure_utc(moment)
        return identity.coverage_start <= instant <= identity.coverage_end

    @staticmethod
    def _refresh_reasons(
        *,
        cache_fresh: bool | None,
        coverage_current: bool | None,
    ) -> tuple[str, ...]:
        """Return non-overlapping, machine-readable refresh causes.

        ``cache`` means the local bytes exceed the configured cache age;
        ``coverage`` means valid bytes do not cover the checked UTC instant.
        Keeping those facts separate prevents a publication lag at IERS from
        being misreported as a local cache/download failure.
        """

        reasons: list[str] = []
        if cache_fresh is False:
            reasons.append("cache")
        if coverage_current is False:
            reasons.append("coverage")
        return tuple(reasons)

    def _write_atomically(self, raw: bytes) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self.cache_path.name}.", suffix=".tmp", dir=self.cache_path.parent
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.cache_path)
        except OSError:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _install(
        self,
        provider: IersC01EarthOrientationProvider,
        *,
        last_update: datetime.datetime | None,
        last_validation: datetime.datetime,
        status: EopStatus,
        error: str | None,
        refresh_due: bool,
        using_cached_fallback: bool,
        cache_fresh: bool | None = None,
        coverage_current: bool | None = None,
        refresh_reasons: tuple[str, ...] = (),
    ) -> None:
        identity = provider.snapshot_identity
        assert identity is not None
        coverage_warning = not self._covers(provider, last_validation)
        if coverage_current is None:
            coverage_current = not coverage_warning
        if coverage_warning and "coverage" not in refresh_reasons:
            refresh_reasons = (*refresh_reasons, "coverage")
        final_status: EopStatus = "warning" if status == "ok" and coverage_warning else status
        final_error = error
        if coverage_warning:
            final_error = self._join_errors(
                final_error,
                self._coverage_message(identity, last_validation),
            )
        diagnostic = EopCacheDiagnostics(
            status=final_status,
            loaded=True,
            source=IERS_EOP_C01_SOURCE,
            source_url=self.url,
            cache_file=self.cache_path.name,
            last_update=last_update,
            last_validation=last_validation,
            coverage_start=identity.coverage_start,
            coverage_end=identity.coverage_end,
            record_count=identity.record_count,
            error=final_error,
            refresh_due=refresh_due,
            using_cached_fallback=using_cached_fallback,
            cache_fresh=cache_fresh,
            coverage_current=coverage_current,
            refresh_reasons=refresh_reasons,
        )
        with self._state_lock:
            self._provider = provider
            self._diagnostics = diagnostic
        LOGGER.info("ERP source: %s", diagnostic.source)
        LOGGER.info("ERP last update: %s", _iso(diagnostic.last_update) or "unknown")
        LOGGER.info("ERP status: %s", diagnostic.status.upper())

    def _install_missing(self, now: datetime.datetime, *, status: EopStatus, error: str) -> None:
        diagnostic = EopCacheDiagnostics(
            status=status,
            loaded=False,
            source=IERS_EOP_C01_SOURCE,
            source_url=self.url,
            cache_file=self.cache_path.name,
            last_validation=now,
            error=error,
            refresh_due=True,
        )
        with self._state_lock:
            # Do not destroy a previously validated in-memory snapshot if a
            # third party damages its on-disk cache after startup.
            if self._provider is None:
                self._diagnostics = diagnostic
            else:
                existing = self._diagnostics
                self._diagnostics = EopCacheDiagnostics(
                    status="warning",
                    loaded=True,
                    source=existing.source,
                    source_url=existing.source_url,
                    cache_file=existing.cache_file,
                    last_update=existing.last_update,
                    last_validation=now,
                    coverage_start=existing.coverage_start,
                    coverage_end=existing.coverage_end,
                    record_count=existing.record_count,
                    error=f"La copia EOP en disco ya no es válida; se conserva el snapshot en memoria: {error}",
                    refresh_due=True,
                    using_cached_fallback=True,
                    cache_fresh=existing.cache_fresh,
                    coverage_current=existing.coverage_current,
                    refresh_reasons=existing.refresh_reasons or ("cache",),
                )
                diagnostic = self._diagnostics
        LOGGER.info("ERP source: %s", diagnostic.source)
        LOGGER.info("ERP last update: %s", _iso(diagnostic.last_update) or "unknown")
        LOGGER.info("ERP status: %s", diagnostic.status.upper())

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        message = " ".join(str(exc).strip().split())
        return message[:500] if message else type(exc).__name__

    @staticmethod
    def _coverage_message(identity: EopSnapshotIdentity, moment: datetime.datetime) -> str:
        """Describe a factual C01 coverage gap without implying extrapolation."""

        instant = ensure_utc(moment)
        if instant > identity.coverage_end:
            return (
                "La cobertura EOP disponible termina el "
                f"{_iso(identity.coverage_end)}; no se extrapolan valores fuera de ese límite."
            )
        if instant < identity.coverage_start:
            return (
                "La cobertura EOP disponible comienza el "
                f"{_iso(identity.coverage_start)}; no se extrapolan valores fuera de ese límite."
            )
        return "La cobertura EOP disponible no incluye el instante validado."

    @staticmethod
    def _join_errors(*messages: str | None) -> str | None:
        """Join bounded diagnostic clauses while avoiding duplicate text."""

        unique = [
            message
            for index, message in enumerate(messages)
            if message and message not in messages[:index]
        ]
        return " ".join(unique) or None

    @staticmethod
    def _download_https(url: str, timeout_seconds: float, max_bytes: int) -> bytes:
        """Download a bounded HTTPS response using Python's verified TLS stack."""

        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "datacenter.iers.org":
            raise ValueError("La descarga automática EOP solo admite el host HTTPS oficial de IERS")
        if url not in {IERS_EOP_C01_URL, IERS_FINALS2000A_URL}:
            raise ValueError(
                "La descarga automática EOP debe usar la URL oficial EOP_C01_IAU2000 o finals2000A.all"
            )
        request = Request(
            url,
            headers={
                "Accept": "text/plain, text/*;q=0.9, */*;q=0.1",
                "User-Agent": "Orbit-Tracker-EOP-Monitor/1",
            },
            method="GET",
        )
        # ``urllib`` follows redirects by default.  Do not permit a response
        # from the fixed IERS URL to silently switch the scientific source to
        # another origin or a different path.
        with build_opener(_RejectRedirects()).open(request, timeout=timeout_seconds) as response:
            status = int(getattr(response, "status", response.getcode()))
            if status != 200:
                raise OSError(f"IERS respondió HTTP {status}")
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    declared = int(length)
                except ValueError as exc:
                    raise OSError("IERS devolvió un Content-Length inválido") from exc
                if declared < 0 or declared > max_bytes:
                    raise OSError("La respuesta EOP excede el tamaño máximo permitido")
            chunks: list[bytes] = []
            total = 0
            while True:
                block = response.read(min(64 * 1024, max_bytes + 1 - total))
                if not block:
                    break
                total += len(block)
                if total > max_bytes:
                    raise OSError("La respuesta EOP excede el tamaño máximo permitido")
                chunks.append(block)
            return b"".join(chunks)


class IersFinals2000ACacheService:
    """Thread-safe cache for the official IERS rapid/predicted EOP product.

    It intentionally has no nominal fallback.  The composite automatic route
    below owns source selection and makes every degradation visible; using the
    rapid cache directly therefore remains fail-closed outside its coverage.
    """

    def __init__(
        self,
        cache_path: str | Path,
        *,
        url: str = IERS_FINALS2000A_URL,
        refresh_age: datetime.timedelta = IERS_FINALS2000A_REFRESH_AGE,
        timeout_seconds: float = IERS_FINALS2000A_DOWNLOAD_TIMEOUT_SECONDS,
        max_bytes: int = IERS_FINALS2000A_MAX_BYTES,
        fetcher: DownloadFetcher | None = None,
        now: Callable[[], datetime.datetime] = utc_now,
    ) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("La URL automática finals2000A debe usar HTTPS")
        if refresh_age <= datetime.timedelta(0):
            raise ValueError("refresh_age debe ser positivo")
        try:
            timeout = float(timeout_seconds)
        except (TypeError, ValueError) as exc:
            raise ValueError("timeout_seconds debe estar entre 0.1 y 120 segundos") from exc
        if not math.isfinite(timeout) or not 0.1 <= timeout <= 120.0:
            raise ValueError("timeout_seconds debe estar entre 0.1 y 120 segundos")
        try:
            byte_limit = int(max_bytes)
        except (TypeError, ValueError) as exc:
            raise ValueError("max_bytes debe estar entre 1 KiB y 128 MiB") from exc
        if isinstance(max_bytes, bool) or byte_limit != max_bytes or not 1_024 <= byte_limit <= 128 * 1024 * 1024:
            raise ValueError("max_bytes debe estar entre 1 KiB y 128 MiB")
        self.cache_path = Path(cache_path)
        self.url = url
        self.refresh_age = refresh_age
        self.timeout_seconds = timeout
        self.max_bytes = byte_limit
        self._fetcher = fetcher or IersEopCacheService._download_https
        self._now = now
        self._state_lock = threading.RLock()
        self._refresh_lock = threading.Lock()
        self._provider: IersFinals2000AEarthOrientationProvider | None = None
        self._diagnostics = EopCacheDiagnostics(
            status="warning",
            loaded=False,
            source=IERS_FINALS2000A_SOURCE,
            source_url=self.url,
            cache_file=self.cache_path.name,
            error="La carga automática de finals2000A todavía no se ha ejecutado.",
            refresh_due=True,
            format_name="IERS finals2000A.all",
        )

    @property
    def active_provider(self) -> IersFinals2000AEarthOrientationProvider | None:
        with self._state_lock:
            return self._provider

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        with self._state_lock:
            provider = self._provider
        if provider is None:
            raise EarthOrientationCoverageError("No hay un snapshot finals2000A local validado")
        return provider.at(moment)

    def diagnostics(self) -> EopCacheDiagnostics:
        with self._state_lock:
            return self._diagnostics

    def diagnostics_payload(self) -> dict[str, object]:
        return self.diagnostics().payload()

    def refresh_if_needed(self) -> EopCacheDiagnostics:
        """Refresh a bounded, validated finals cache without replacing good bytes."""

        if not self._refresh_lock.acquire(blocking=False):
            return self.diagnostics()
        try:
            now = ensure_utc(self._now())
            cached, update, cache_error = self._load_cached()
            fresh = cached is not None and update is not None and self._is_fresh(update, now)
            current = cached is not None and self._covers(cached, now)
            if cached is not None:
                self._install(
                    cached,
                    last_update=update,
                    last_validation=now,
                    status="ok" if fresh and current else "warning",
                    error=None if fresh else "El snapshot finals2000A local supera la antigüedad máxima de 7 días.",
                    refresh_due=not (fresh and current),
                    using_cached_fallback=not fresh,
                    cache_fresh=fresh,
                    coverage_current=current,
                    refresh_reasons=self._refresh_reasons(fresh, current),
                )
            if fresh and current:
                return self.diagnostics()
            try:
                raw = self._fetcher(self.url, self.timeout_seconds, self.max_bytes)
                if not isinstance(raw, bytes):
                    raise EopSnapshotValidationError("La descarga finals2000A no devolvió bytes")
                if not raw:
                    raise EopSnapshotValidationError("La descarga finals2000A está vacía")
                if len(raw) > self.max_bytes:
                    raise EopSnapshotValidationError("La descarga finals2000A supera el tamaño máximo permitido")
                provider = IersFinals2000AEarthOrientationProvider.from_bytes(
                    raw,
                    filename=self.cache_path.name or IERS_FINALS2000A_FILENAME,
                )
                self._write_atomically(raw)
                update = datetime.datetime.fromtimestamp(self.cache_path.stat().st_mtime, tz=datetime.UTC)
                refreshed_current = self._covers(provider, now)
                self._install(
                    provider,
                    last_update=update,
                    last_validation=now,
                    status="ok" if refreshed_current else "warning",
                    error=(
                        None
                        if refreshed_current
                        else "IERS finals2000A se actualizó y validó, pero la fuente publicada no cubre el instante actual."
                    ),
                    refresh_due=not refreshed_current,
                    using_cached_fallback=False,
                    cache_fresh=True,
                    coverage_current=refreshed_current,
                    refresh_reasons=self._refresh_reasons(True, refreshed_current),
                )
            except Exception as exc:  # noqa: BLE001 - transport/untrusted-content boundary
                message = IersEopCacheService._safe_error(exc)
                if cached is not None:
                    self._install(
                        cached,
                        last_update=update,
                        last_validation=now,
                        status="warning",
                        error=IersEopCacheService._join_errors(
                            f"No se pudo actualizar finals2000A; se conserva la última copia válida: {message}",
                            None if fresh else "El snapshot finals2000A local supera la antigüedad máxima de 7 días.",
                        ),
                        refresh_due=True,
                        using_cached_fallback=True,
                        cache_fresh=fresh,
                        coverage_current=current,
                        refresh_reasons=self._refresh_reasons(fresh, current) or ("cache",),
                    )
                else:
                    invalid_remote = isinstance(exc, EopSnapshotValidationError)
                    self._install_missing(
                        now,
                        status="error" if invalid_remote else "warning",
                        error=(
                            f"No hay una copia finals2000A válida disponible: {message}"
                            if cache_error is None
                            else f"No hay una copia finals2000A válida disponible ({cache_error}): {message}"
                        ),
                    )
            return self.diagnostics()
        finally:
            self._refresh_lock.release()

    def validate_cached(self) -> EopCacheDiagnostics:
        """Validate only local finals bytes; never contacts IERS."""

        now = ensure_utc(self._now())
        provider, update, error = self._load_cached()
        if provider is None:
            self._install_missing(
                now,
                status="warning",
                error=error or "No existe una copia finals2000A local válida.",
            )
        else:
            fresh = self._is_fresh(update, now) if update is not None else False
            current = self._covers(provider, now)
            self._install(
                provider,
                last_update=update,
                last_validation=now,
                status="ok" if fresh and current else "warning",
                error=None if fresh else "El snapshot finals2000A local supera la antigüedad máxima de 7 días.",
                refresh_due=not (fresh and current),
                using_cached_fallback=not fresh,
                cache_fresh=fresh,
                coverage_current=current,
                refresh_reasons=self._refresh_reasons(fresh, current),
            )
        return self.diagnostics()

    def _load_cached(
        self,
    ) -> tuple[IersFinals2000AEarthOrientationProvider | None, datetime.datetime | None, str | None]:
        try:
            metadata = self.cache_path.stat()
        except FileNotFoundError:
            return None, None, None
        except OSError as exc:
            return None, None, IersEopCacheService._safe_error(exc)
        if metadata.st_size <= 0:
            return None, None, "El archivo finals2000A local está vacío."
        if metadata.st_size > self.max_bytes:
            return None, None, "El archivo finals2000A local supera el tamaño máximo permitido."
        try:
            provider = IersFinals2000AEarthOrientationProvider.from_file(self.cache_path)
        except (OSError, ValueError) as exc:
            return None, None, IersEopCacheService._safe_error(exc)
        update = datetime.datetime.fromtimestamp(metadata.st_mtime, tz=datetime.UTC)
        return provider, update, None

    def _is_fresh(self, update: datetime.datetime, now: datetime.datetime) -> bool:
        return ensure_utc(now) - ensure_utc(update) <= self.refresh_age

    @staticmethod
    def _covers(provider: IersFinals2000AEarthOrientationProvider, moment: datetime.datetime) -> bool:
        identity = provider.snapshot_identity
        if identity is None:
            return False
        instant = ensure_utc(moment)
        return identity.coverage_start <= instant <= identity.coverage_end

    @staticmethod
    def _refresh_reasons(cache_fresh: bool, coverage_current: bool) -> tuple[str, ...]:
        reasons: list[str] = []
        if not cache_fresh:
            reasons.append("cache")
        if not coverage_current:
            reasons.append("coverage")
        return tuple(reasons)

    def _write_atomically(self, raw: bytes) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self.cache_path.name}.", suffix=".tmp", dir=self.cache_path.parent
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.cache_path)
        except OSError:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def _install(
        self,
        provider: IersFinals2000AEarthOrientationProvider,
        *,
        last_update: datetime.datetime | None,
        last_validation: datetime.datetime,
        status: EopStatus,
        error: str | None,
        refresh_due: bool,
        using_cached_fallback: bool,
        cache_fresh: bool,
        coverage_current: bool,
        refresh_reasons: tuple[str, ...],
    ) -> None:
        identity = provider.snapshot_identity
        assert identity is not None
        coverage_warning = not self._covers(provider, last_validation)
        if coverage_warning:
            error = IersEopCacheService._join_errors(
                error,
                self._coverage_message(identity, last_validation),
            )
            status = "warning" if status == "ok" else status
        diagnostic = EopCacheDiagnostics(
            status=status,
            loaded=True,
            source=IERS_FINALS2000A_SOURCE,
            source_url=self.url,
            cache_file=self.cache_path.name,
            last_update=last_update,
            last_validation=last_validation,
            coverage_start=identity.coverage_start,
            coverage_end=identity.coverage_end,
            record_count=identity.record_count,
            error=error,
            refresh_due=refresh_due,
            using_cached_fallback=using_cached_fallback,
            cache_fresh=cache_fresh,
            coverage_current=coverage_current,
            refresh_reasons=refresh_reasons,
            selection={"format": "IERS finals2000A.all"},
            format_name="IERS finals2000A.all",
        )
        with self._state_lock:
            self._provider = provider
            self._diagnostics = diagnostic
        LOGGER.info("ERP source: %s", diagnostic.source)
        LOGGER.info("ERP last update: %s", _iso(diagnostic.last_update) or "unknown")
        LOGGER.info("ERP status: %s", diagnostic.status.upper())

    def _install_missing(self, now: datetime.datetime, *, status: EopStatus, error: str) -> None:
        diagnostic = EopCacheDiagnostics(
            status=status,
            loaded=False,
            source=IERS_FINALS2000A_SOURCE,
            source_url=self.url,
            cache_file=self.cache_path.name,
            last_validation=now,
            error=error,
            refresh_due=True,
            format_name="IERS finals2000A.all",
        )
        with self._state_lock:
            if self._provider is None:
                self._diagnostics = diagnostic
            else:
                existing = self._diagnostics
                self._diagnostics = EopCacheDiagnostics(
                    status="warning",
                    loaded=True,
                    source=existing.source,
                    source_url=existing.source_url,
                    cache_file=existing.cache_file,
                    last_update=existing.last_update,
                    last_validation=now,
                    coverage_start=existing.coverage_start,
                    coverage_end=existing.coverage_end,
                    record_count=existing.record_count,
                    error=(
                        "La copia finals2000A en disco ya no es válida; se conserva el snapshot en memoria: "
                        f"{error}"
                    ),
                    refresh_due=True,
                    using_cached_fallback=True,
                    cache_fresh=existing.cache_fresh,
                    coverage_current=existing.coverage_current,
                    refresh_reasons=existing.refresh_reasons or ("cache",),
                    format_name="IERS finals2000A.all",
                )
                diagnostic = self._diagnostics
        LOGGER.info("ERP source: %s", diagnostic.source)
        LOGGER.info("ERP last update: %s", _iso(diagnostic.last_update) or "unknown")
        LOGGER.info("ERP status: %s", diagnostic.status.upper())

    @staticmethod
    def _coverage_message(identity: EopSnapshotIdentity, moment: datetime.datetime) -> str:
        instant = ensure_utc(moment)
        if instant > identity.coverage_end:
            return (
                "La cobertura finals2000A disponible termina el "
                f"{_iso(identity.coverage_end)}; no se usan valores IERS fuera de ese límite."
            )
        if instant < identity.coverage_start:
            return (
                "La cobertura finals2000A disponible comienza el "
                f"{_iso(identity.coverage_start)}; no se usan valores IERS fuera de ese límite."
            )
        return "La cobertura finals2000A disponible no incluye el instante validado."


class IersLinearTailEarthOrientationProvider:
    """Explicit, bounded linear continuation after an official finals snapshot.

    It is deliberately not a subclass of the IERS provider: source, version
    and quality identify the result as Orbit's extrapolation instead of a
    published IERS solution.  The end of the 30-day bound is handled by the
    composite route as the nominal visual fallback.
    """

    def __init__(
        self,
        provider: IersFinals2000AEarthOrientationProvider,
        *,
        horizon: datetime.timedelta = IERS_LINEAR_EXTRAPOLATION_MAX_HORIZON,
    ) -> None:
        identity = provider.snapshot_identity
        if identity is None or len(provider.samples) < 2:
            raise ValueError("finals2000A requiere al menos dos muestras para la extrapolación lineal")
        if horizon <= datetime.timedelta(0):
            raise ValueError("El horizonte de extrapolación lineal debe ser positivo")
        self._provider = provider
        self._identity = identity
        self._horizon = horizon
        self._lower = provider.samples[-2]
        self._upper = provider.samples[-1]
        assert self._lower.sampled_at is not None and self._upper.sampled_at is not None

    @property
    def starts_after(self) -> datetime.datetime:
        return self._identity.coverage_end

    @property
    def ends_at(self) -> datetime.datetime:
        return self._identity.coverage_end + self._horizon

    @property
    def horizon(self) -> datetime.timedelta:
        return self._horizon

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        instant = ensure_utc(moment)
        if instant <= self.starts_after:
            raise EarthOrientationCoverageError("La extrapolación lineal solo aplica después de finals2000A")
        if instant > self.ends_at:
            raise EarthOrientationCoverageError("La extrapolación lineal supera su horizonte de seguridad")
        assert self._lower.sampled_at is not None and self._upper.sampled_at is not None
        step_seconds = (self._upper.sampled_at - self._lower.sampled_at).total_seconds()
        if step_seconds <= 0.0:
            raise EarthOrientationCoverageError("Las últimas muestras finals2000A no permiten una pendiente lineal")
        factor = (instant - self._upper.sampled_at).total_seconds() / step_seconds

        def extend(name: str) -> float:
            upper = float(getattr(self._upper, name))
            lower = float(getattr(self._lower, name))
            return upper + factor * (upper - lower)

        lod: float | None
        if self._lower.lod_seconds is None or self._upper.lod_seconds is None:
            lod = None
        else:
            lod = extend("lod_seconds")
        return EarthOrientation(
            dut1_seconds=extend("dut1_seconds"),
            xp_radians=extend("xp_radians"),
            yp_radians=extend("yp_radians"),
            dx_radians=extend("dx_radians"),
            dy_radians=extend("dy_radians"),
            lod_seconds=lod,
            source="Orbit linear extrapolation after IERS finals2000A.all",
            version=f"{IERS_FINALS2000A_FILENAME}:linear-tail",
            quality="extrapolated",
            sampled_at=instant,
            snapshot_id=self._upper.snapshot_id,
        )


class IersAutomaticEarthOrientationService(EarthOrientationProvider):
    """Choose C01, finals2000A, a bounded linear tail, then nominal rotation.

    Selection is deterministic for a given pair of cached snapshots:

    1. C01 has priority while it covers the requested UTC instant.
    2. Official IERS ``finals2000A.all`` continues coverage afterwards.
    3. A maximum 30-day *explicit* linear tail starts only after finals ends.
    4. Beyond that bound, the visual UTC≈UT1 provider is used and labelled.

    Product-bound manual ERP and precise-SP3 providers never pass through this
    service, so their strict coverage rules remain unchanged.
    """

    def __init__(
        self,
        c01_cache_path: str | Path,
        finals_cache_path: str | Path,
        *,
        leap_seconds: LeapSecondTable | None = None,
        c01_fetcher: DownloadFetcher | None = None,
        finals_fetcher: DownloadFetcher | None = None,
        now: Callable[[], datetime.datetime] = utc_now,
        linear_extrapolation_horizon: datetime.timedelta = IERS_LINEAR_EXTRAPOLATION_MAX_HORIZON,
    ) -> None:
        if linear_extrapolation_horizon <= datetime.timedelta(0):
            raise ValueError("El horizonte de extrapolación lineal debe ser positivo")
        self._now = now
        self._horizon = linear_extrapolation_horizon
        self.c01_cache = IersEopCacheService(
            c01_cache_path,
            leap_seconds=leap_seconds,
            fetcher=c01_fetcher,
            now=now,
        )
        self.finals_cache = IersFinals2000ACacheService(
            finals_cache_path,
            fetcher=finals_fetcher,
            now=now,
        )
        self._fallback = VisualApproximationEarthOrientationProvider()
        self._state_lock = threading.RLock()
        self._refresh_lock = threading.Lock()
        initial = ensure_utc(now())
        self._diagnostics = self._build_diagnostics(initial)

    @property
    def cache_path(self) -> Path:
        """Compatibility path for callers that previously saw only C01."""

        return self.c01_cache.cache_path

    @property
    def finals_cache_path(self) -> Path:
        """Local path of the separate official finals2000A cache."""

        return self.finals_cache.cache_path

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        route = self._route_at(ensure_utc(moment))
        provider = route.get("provider")
        if isinstance(provider, (IersC01EarthOrientationProvider, IersFinals2000AEarthOrientationProvider)):
            return provider.at(moment)
        if isinstance(provider, IersLinearTailEarthOrientationProvider):
            return provider.at(moment)
        return self._fallback.at(moment)

    def diagnostics(self) -> EopCacheDiagnostics:
        with self._state_lock:
            return self._diagnostics

    def diagnostics_payload(self) -> dict[str, object]:
        return self.diagnostics().payload()

    def refresh_if_needed(self) -> EopCacheDiagnostics:
        """Refresh both official sources; child cache writes are atomic."""

        if not self._refresh_lock.acquire(blocking=False):
            return self.diagnostics()
        try:
            self.c01_cache.refresh_if_needed()
            self.finals_cache.refresh_if_needed()
            self._publish(ensure_utc(self._now()))
            return self.diagnostics()
        finally:
            self._refresh_lock.release()

    def validate_cached(self) -> EopCacheDiagnostics:
        """Validate both local caches without starting a download."""

        self.c01_cache.validate_cached()
        self.finals_cache.validate_cached()
        self._publish(ensure_utc(self._now()))
        return self.diagnostics()

    def classify_window(
        self,
        start: datetime.datetime,
        end: datetime.datetime,
    ) -> dict[str, object]:
        """Describe source/quality transitions across an operation window.

        Consumers can warn before a propagation begins, including the important
        partial case where only the tail of the requested time span leaves
        published IERS coverage.
        """

        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        if end_utc < start_utc:
            raise ValueError("El final de la ventana EOP no puede preceder al inicio")
        boundaries = {start_utc, end_utc}
        for provider in (self.c01_cache.active_provider, self.finals_cache.active_provider):
            identity = provider.snapshot_identity if provider is not None else None
            if identity is not None:
                if start_utc < identity.coverage_start < end_utc:
                    boundaries.add(identity.coverage_start)
                if start_utc < identity.coverage_end < end_utc:
                    boundaries.add(identity.coverage_end)
        finals = self.finals_cache.active_provider
        if finals is not None:
            for _quality, segment_start, segment_end in finals.quality_segments:
                if start_utc < segment_start < end_utc:
                    boundaries.add(segment_start)
                if start_utc < segment_end < end_utc:
                    boundaries.add(segment_end)
            try:
                tail = IersLinearTailEarthOrientationProvider(finals, horizon=self._horizon)
            except ValueError:
                tail = None
            if tail is not None:
                if start_utc < tail.starts_after < end_utc:
                    boundaries.add(tail.starts_after)
                if start_utc < tail.ends_at < end_utc:
                    boundaries.add(tail.ends_at)
        points = sorted(boundaries)
        segments: list[dict[str, object]] = []
        for index, segment_start in enumerate(points):
            segment_end = points[index + 1] if index + 1 < len(points) else end_utc
            if segment_start == segment_end and len(points) > 1:
                continue
            probe = segment_start if segment_start == segment_end else segment_start + (segment_end - segment_start) / 2
            route = self._route_at(probe)
            item = self._route_payload(route, start=segment_start, end=segment_end)
            if segments and self._same_route(segments[-1], item):
                segments[-1]["end"] = item["end"]
            else:
                segments.append(item)
            if segment_end == end_utc:
                break
        outside_iers = any(item["kind"] in {"linear-extrapolation", "nominal-fallback"} for item in segments)
        uses_linear = any(item["kind"] == "linear-extrapolation" for item in segments)
        uses_nominal = any(item["kind"] == "nominal-fallback" for item in segments)
        return {
            "start": _iso(start_utc),
            "end": _iso(end_utc),
            "segments": segments,
            "usesIersEopThroughWindow": not outside_iers,
            "outsideIersCoverage": outside_iers,
            "requiresLinearExtrapolation": uses_linear,
            "usesNominalFallback": uses_nominal,
            "requiresAttention": any(bool(item["requiresAttention"]) for item in segments),
        }

    def _publish(self, now: datetime.datetime) -> None:
        diagnostic = self._build_diagnostics(now)
        with self._state_lock:
            self._diagnostics = diagnostic
        LOGGER.info("ERP source: %s", diagnostic.source)
        LOGGER.info("ERP status: %s", diagnostic.status.upper())

    def _build_diagnostics(self, now: datetime.datetime) -> EopCacheDiagnostics:
        c01 = self.c01_cache.diagnostics()
        finals = self.finals_cache.diagnostics()
        route = self._route_at(now)
        sources = {
            "c01": self._source_payload("iers-c01", c01, quality="final"),
            "finals2000A": self._source_payload("iers-finals2000a", finals),
        }
        timeline = self._coverage_timeline()
        identities = [
            item.snapshot_identity
            for item in (self.c01_cache.active_provider, self.finals_cache.active_provider)
            if item is not None and item.snapshot_identity is not None
        ]
        coverage_start = min((item.coverage_start for item in identities), default=None)
        coverage_end = max((item.coverage_end for item in identities), default=None)
        kind = str(route["kind"])
        quality = str(route["quality"])
        exact_coverage = kind in {"iers-c01", "iers-finals2000a"}
        status: EopStatus
        error: str | None = None
        if exact_coverage and quality != "predicted":
            status = "ok"
        elif exact_coverage:
            status = "warning"
            error = "La ventana actual usa una predicción IERS finals2000A; no es una solución final."
        elif kind == "linear-extrapolation":
            status = "warning"
            error = (
                "La cobertura IERS terminó; Orbit usa una extrapolación lineal limitada y explícitamente etiquetada."
            )
        else:
            status = "error" if c01.status == "error" and finals.status == "error" else "warning"
            error = "No hay cobertura IERS para el instante actual; Orbit usa la rotación terrestre nominal."
        refresh_reasons = tuple(
            [f"c01:{reason}" for reason in c01.refresh_reasons]
            + [f"finals2000A:{reason}" for reason in finals.refresh_reasons]
        )
        selected_source = str(route["source"])
        source_url = str(route.get("sourceUrl") or "")
        record_count = sum(item.record_count for item in (c01, finals))
        return EopCacheDiagnostics(
            status=status,
            loaded=c01.loaded or finals.loaded,
            source=selected_source,
            source_url=source_url,
            cache_file=f"{c01.cache_file}, {finals.cache_file}",
            last_update=max(
                (item.last_update for item in (c01, finals) if item.last_update is not None),
                default=None,
            ),
            last_validation=now,
            coverage_start=coverage_start,
            coverage_end=coverage_end,
            record_count=record_count,
            error=error,
            refresh_due=c01.refresh_due or finals.refresh_due,
            using_cached_fallback=c01.using_cached_fallback or finals.using_cached_fallback,
            cache_fresh=(
                bool(c01.cache_fresh) and bool(finals.cache_fresh)
                if c01.loaded and finals.loaded
                else None
            ),
            coverage_current=exact_coverage,
            refresh_reasons=refresh_reasons,
            sources=sources,
            coverage_timeline=tuple(timeline),
            selection=self._selection_payload(route),
            format_name="IERS automatic C01 + finals2000A",
        )

    def _route_at(self, instant: datetime.datetime) -> dict[str, object]:
        c01 = self.c01_cache.active_provider
        if c01 is not None and IersEopCacheService._covers(c01, instant):
            orientation = c01.at(instant)
            return {
                "kind": "iers-c01",
                "provider": c01,
                "source": orientation.source,
                "sourceUrl": IERS_EOP_C01_URL,
                "quality": orientation.quality,
            }
        finals = self.finals_cache.active_provider
        if finals is not None and IersFinals2000ACacheService._covers(finals, instant):
            orientation = finals.at(instant)
            return {
                "kind": "iers-finals2000a",
                "provider": finals,
                "source": orientation.source,
                "sourceUrl": IERS_FINALS2000A_URL,
                "quality": orientation.quality,
            }
        if finals is not None:
            try:
                tail = IersLinearTailEarthOrientationProvider(finals, horizon=self._horizon)
                if tail.starts_after < instant <= tail.ends_at:
                    return {
                        "kind": "linear-extrapolation",
                        "provider": tail,
                        "source": "Orbit linear extrapolation after IERS finals2000A.all",
                        "sourceUrl": None,
                        "quality": "extrapolated",
                    }
            except ValueError:
                pass
        return {
            "kind": "nominal-fallback",
            "provider": self._fallback,
            "source": "UTC≈UT1 visual fallback",
            "sourceUrl": None,
            "quality": "approximate",
        }

    @staticmethod
    def _same_route(previous: dict[str, object], current: dict[str, object]) -> bool:
        return all(previous.get(key) == current.get(key) for key in ("kind", "source", "quality"))

    def _route_payload(
        self,
        route: dict[str, object],
        *,
        start: datetime.datetime,
        end: datetime.datetime,
    ) -> dict[str, object]:
        quality = str(route["quality"])
        kind = str(route["kind"])
        return {
            "kind": kind,
            "start": _iso(start),
            "end": _iso(end),
            "source": route["source"],
            "sourceUrl": route.get("sourceUrl"),
            "quality": quality,
            "isIers": kind in {"iers-c01", "iers-finals2000a"},
            "requiresAttention": quality in {"predicted", "extrapolated", "approximate"},
        }

    @staticmethod
    def _source_payload(
        kind: str,
        diagnostic: EopCacheDiagnostics,
        *,
        quality: str | None = None,
    ) -> dict[str, object]:
        coverage = (
            {"start": _iso(diagnostic.coverage_start), "end": _iso(diagnostic.coverage_end)}
            if diagnostic.coverage_start is not None and diagnostic.coverage_end is not None
            else None
        )
        payload: dict[str, object] = {
            "kind": kind,
            "source": diagnostic.source,
            "sourceUrl": diagnostic.source_url,
            "cacheFile": diagnostic.cache_file,
            "status": diagnostic.status,
            "loaded": diagnostic.loaded,
            "coverage": coverage,
            "recordCount": diagnostic.record_count,
            "lastUpdate": _iso(diagnostic.last_update),
            "cacheFresh": diagnostic.cache_fresh,
            "coverageCurrent": diagnostic.coverage_current,
            "refreshDue": diagnostic.refresh_due,
            "error": diagnostic.error,
        }
        if quality is not None:
            payload["quality"] = quality
        return payload

    def _coverage_timeline(self) -> list[dict[str, object]]:
        timeline: list[dict[str, object]] = []
        c01 = self.c01_cache.active_provider
        c01_identity = c01.snapshot_identity if c01 is not None else None
        if c01_identity is not None:
            timeline.append(
                {
                    "kind": "iers-c01",
                    "start": _iso(c01_identity.coverage_start),
                    "end": _iso(c01_identity.coverage_end),
                    "source": IERS_EOP_C01_SOURCE,
                    "sourceUrl": IERS_EOP_C01_URL,
                    "quality": "final",
                    "qualityLabel": "IERS C01 combinado/final",
                }
            )
        finals = self.finals_cache.active_provider
        finals_identity = finals.snapshot_identity if finals is not None else None
        if finals is not None and finals_identity is not None:
            labels = {
                "final": "Bulletin B final (LOD Bulletin A/opcional)",
                "rapid": "Bulletin A rapid",
                "predicted": "Bulletin A prediction",
            }
            for quality, start, end in finals.quality_segments:
                timeline.append(
                    {
                        "kind": "iers-finals2000a",
                        "start": _iso(start),
                        "end": _iso(end),
                        "source": IERS_FINALS2000A_SOURCE,
                        "sourceUrl": IERS_FINALS2000A_URL,
                        "quality": quality,
                        "qualityLabel": labels.get(quality, quality),
                    }
                )
            try:
                tail = IersLinearTailEarthOrientationProvider(finals, horizon=self._horizon)
            except ValueError:
                tail = None
            if tail is not None:
                timeline.append(
                    {
                        "kind": "linear-extrapolation",
                        "start": _iso(tail.starts_after),
                        "end": _iso(tail.ends_at),
                        "startsAfter": _iso(tail.starts_after),
                        "source": "Orbit linear extrapolation after IERS finals2000A.all",
                        "sourceUrl": None,
                        "quality": "extrapolated",
                        "qualityLabel": "Extrapolación lineal; no es dato IERS",
                        "maxHorizonDays": tail.horizon.total_seconds() / 86_400.0,
                    }
                )
                timeline.append(
                    {
                        "kind": "nominal-fallback",
                        "start": _iso(tail.ends_at),
                        "end": None,
                        "startsAfter": _iso(tail.ends_at),
                        "source": "UTC≈UT1 visual fallback",
                        "sourceUrl": None,
                        "quality": "approximate",
                        "qualityLabel": "Rotación nominal; no hay EOP IERS ni extrapolación permitida",
                    }
                )
        return timeline

    def _selection_payload(self, route: dict[str, object]) -> dict[str, object]:
        finals = self.finals_cache.active_provider
        finals_identity = finals.snapshot_identity if finals is not None else None
        tail: IersLinearTailEarthOrientationProvider | None
        if finals is not None:
            try:
                tail = IersLinearTailEarthOrientationProvider(finals, horizon=self._horizon)
            except ValueError:
                tail = None
        else:
            tail = None
        return {
            "policy": "c01-then-finals2000A-then-bounded-linear-tail-then-nominal",
            "current": {
                "kind": route["kind"],
                "source": route["source"],
                "quality": route["quality"],
            },
            "c01Preferred": True,
            "finalsCoverage": (
                {"start": _iso(finals_identity.coverage_start), "end": _iso(finals_identity.coverage_end)}
                if finals_identity is not None
                else None
            ),
            "extrapolationStartsAt": _iso(tail.starts_after) if tail is not None else None,
            "extrapolationStartsAfter": _iso(tail.starts_after) if tail is not None else None,
            "extrapolationEndsAt": _iso(tail.ends_at) if tail is not None else None,
            "nominalFallbackStartsAt": _iso(tail.ends_at) if tail is not None else None,
            "linearExtrapolationMaxDays": (
                tail.horizon.total_seconds() / 86_400.0 if tail is not None else None
            ),
        }

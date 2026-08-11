"""Versioned Earth-orientation data and deterministic local providers.

The transform layer deliberately does not download EOP data during a state
calculation.  An application loads a pinned IERS snapshot (or injects a rapid
provider), and every transformed state records the source/version that was
actually used.  That keeps operational results reproducible and lets a caller
distinguish final, predicted and visual-approximate Earth orientation.
"""

from __future__ import annotations

import bisect
import datetime
import hashlib
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .scales import ensure_utc


ARCSECOND_TO_RADIAN = math.pi / (180.0 * 3_600.0)
_MJD_UNIX_EPOCH = 40_587.0
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_IGS_ERP_MJD_EPOCH = datetime.datetime(1858, 11, 17, tzinfo=datetime.UTC)

# These are deliberately *plausibility* limits, not an EOP accuracy model.
# Their job at the import boundary is to catch a corrupt ERP row or a unit
# mistake (for example raw microarcseconds interpreted as arcseconds) before
# it can rotate a precise orbit by kilometres.  Modern IGS values are normally
# a few tenths of an arcsecond and a few milliseconds or less.  The pole and
# LOD envelopes leave room for real operational variation while remaining far
# below a value that could plausibly be a wrong unit.
IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS = 1.0
IGS_ERP_MAX_ABS_DUT1_SECONDS = 0.5
IGS_ERP_MAX_ABS_LOD_SECONDS = 0.010


class EarthOrientationCoverageError(ValueError):
    """Raised when a requested epoch lies outside a strict EOP snapshot."""


class EopSnapshotValidationError(ValueError):
    """Raised when an operator-provided local EOP snapshot is invalid."""


def _normalise_sha256(value: object, *, label: str) -> str:
    digest = str(value or "").strip().lower()
    if digest.startswith("sha256:"):
        digest = digest.removeprefix("sha256:")
    if not _SHA256_PATTERN.fullmatch(digest):
        raise EopSnapshotValidationError(f"{label} debe ser un SHA-256 hexadecimal de 64 caracteres")
    return digest


@dataclass(frozen=True, slots=True)
class EopSnapshotIdentity:
    """Immutable identity and coverage of one local C04 snapshot.

    The absolute filesystem path is intentionally not included: it is an
    operational detail and leaks host layout, while the filename plus SHA-256
    is sufficient to reproduce the exact data product.
    """

    filename: str
    sha256: str
    byte_size: int
    record_count: int
    coverage_start: datetime.datetime
    coverage_end: datetime.datetime

    def __post_init__(self) -> None:
        filename = str(self.filename or "").strip()
        if not filename:
            raise EopSnapshotValidationError("El nombre del snapshot EOP es obligatorio")
        byte_size = int(self.byte_size)
        record_count = int(self.record_count)
        if byte_size <= 0:
            raise EopSnapshotValidationError("El snapshot EOP no puede estar vacío")
        if record_count <= 0:
            raise EopSnapshotValidationError("El snapshot EOP no contiene registros")
        coverage_start = ensure_utc(self.coverage_start)
        coverage_end = ensure_utc(self.coverage_end)
        if coverage_end < coverage_start:
            raise EopSnapshotValidationError("La cobertura final EOP no puede preceder a la inicial")
        object.__setattr__(self, "filename", filename)
        object.__setattr__(self, "sha256", _normalise_sha256(self.sha256, label="El SHA-256 del snapshot EOP"))
        object.__setattr__(self, "byte_size", byte_size)
        object.__setattr__(self, "record_count", record_count)
        object.__setattr__(self, "coverage_start", coverage_start)
        object.__setattr__(self, "coverage_end", coverage_end)

    @property
    def content_id(self) -> str:
        """Return the portable identity attached to EOP-derived results."""

        return f"sha256:{self.sha256}"


def _finite(value: object, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} debe ser numérico") from exc
    if not math.isfinite(number):
        raise ValueError(f"{label} debe ser finito")
    return number


@dataclass(frozen=True, slots=True)
class EarthOrientation:
    """One EOP sample in SI units.

    ``xp_radians``/``yp_radians`` describe polar motion; ``dx_radians`` and
    ``dy_radians`` are optional celestial-pole offsets for the IAU 2006/2000A
    route.  All source labels are part of the numerical contract, not merely
    display metadata.
    """

    dut1_seconds: float = 0.0
    xp_radians: float = 0.0
    yp_radians: float = 0.0
    dx_radians: float = 0.0
    dy_radians: float = 0.0
    lod_seconds: float | None = None
    source: str = "UTC≈UT1 visual fallback"
    version: str | None = "unversioned"
    quality: str = "approximate"
    sampled_at: datetime.datetime | None = None
    snapshot_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "dut1_seconds", _finite(self.dut1_seconds, "DUT1"))
        object.__setattr__(self, "xp_radians", _finite(self.xp_radians, "xp"))
        object.__setattr__(self, "yp_radians", _finite(self.yp_radians, "yp"))
        object.__setattr__(self, "dx_radians", _finite(self.dx_radians, "dX"))
        object.__setattr__(self, "dy_radians", _finite(self.dy_radians, "dY"))
        if self.lod_seconds is not None:
            object.__setattr__(self, "lod_seconds", _finite(self.lod_seconds, "LOD"))
        source = str(self.source or "").strip()
        if not source:
            raise ValueError("La fuente EOP es obligatoria")
        object.__setattr__(self, "source", source)
        version = None if self.version is None else str(self.version).strip()
        object.__setattr__(self, "version", version or None)
        quality = str(self.quality or "").strip().lower()
        if not quality:
            raise ValueError("La calidad EOP es obligatoria")
        object.__setattr__(self, "quality", quality)
        if self.sampled_at is not None:
            object.__setattr__(self, "sampled_at", ensure_utc(self.sampled_at))
        snapshot_id = None if self.snapshot_id is None else str(self.snapshot_id).strip() or None
        object.__setattr__(self, "snapshot_id", snapshot_id)

    @property
    def d_x_radians(self) -> float:
        """Compatibility spelling for IERS ``dX``."""

        return self.dx_radians

    @property
    def d_y_radians(self) -> float:
        """Compatibility spelling for IERS ``dY``."""

        return self.dy_radians

    @property
    def cache_token(self) -> tuple[str, str | None, str]:
        """Stable cache material identifying the EOP product/revision.

        The request epoch already participates in Orbit's ephemeris cache key;
        including ``sampled_at`` here would make the visual fallback change its
        cache identity on every call even though its numerical data are fixed.
        """

        return self.source, self.version, self.quality

    @property
    def identity_token(self) -> tuple[str | None, ...]:
        """Return cache provenance including the local snapshot content ID.

        ``cache_token`` remains a three-item compatibility property. New cache
        users should take this token so a replacement file with an unchanged
        human version still invalidates numerical results.
        """

        return (*self.cache_token, self.snapshot_id) if self.snapshot_id else self.cache_token


class EarthOrientationProvider(Protocol):
    """Return a versioned EOP record for a UTC epoch."""

    def at(self, moment: datetime.datetime) -> EarthOrientation: ...


@dataclass(frozen=True, slots=True)
class StaticEarthOrientationProvider:
    """Inject one deterministic EOP record, useful for a pinned operation."""

    orientation: EarthOrientation

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        utc = ensure_utc(moment)
        return EarthOrientation(
            dut1_seconds=self.orientation.dut1_seconds,
            xp_radians=self.orientation.xp_radians,
            yp_radians=self.orientation.yp_radians,
            dx_radians=self.orientation.dx_radians,
            dy_radians=self.orientation.dy_radians,
            lod_seconds=self.orientation.lod_seconds,
            source=self.orientation.source,
            version=self.orientation.version,
            quality=self.orientation.quality,
            sampled_at=utc,
            snapshot_id=self.orientation.snapshot_id,
        )


class VisualApproximationEarthOrientationProvider:
    """Explicit UTC≈UT1 fallback for visual-only deployments.

    It is intentionally a named provider rather than a hidden default number
    so serialized states expose that no final/rapid IERS record was loaded.
    """

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        return EarthOrientation(
            source="UTC≈UT1 visual fallback",
            version="zero-eop",
            quality="approximate",
            sampled_at=ensure_utc(moment),
        )


class TabularEarthOrientationProvider:
    """Linearly interpolate a finite, versioned EOP sample table.

    EOP products are normally sampled daily or sub-daily. Linear interpolation
    is deterministic and appropriate for the runtime boundary; callers that
    need another interpolation policy can supply their own provider.
    """

    def __init__(self, samples: Iterable[EarthOrientation], *, allow_extrapolation: bool = False) -> None:
        ordered = sorted(
            (sample for sample in samples if sample.sampled_at is not None),
            key=lambda sample: sample.sampled_at,
        )
        if not ordered:
            raise ValueError("Un proveedor EOP tabular requiere al menos una muestra fechada")
        timestamps = [sample.sampled_at for sample in ordered]
        if len(set(timestamps)) != len(timestamps):
            raise ValueError("Las muestras EOP no pueden repetir instante")
        self._samples = tuple(ordered)
        self._timestamps = tuple(timestamps)
        self._allow_extrapolation = bool(allow_extrapolation)

    @property
    def samples(self) -> tuple[EarthOrientation, ...]:
        return self._samples

    def at(self, moment: datetime.datetime) -> EarthOrientation:
        utc = ensure_utc(moment)
        index = bisect.bisect_left(self._timestamps, utc)
        if index < len(self._timestamps) and self._timestamps[index] == utc:
            return self._samples[index]
        if index == 0:
            if not self._allow_extrapolation:
                raise EarthOrientationCoverageError("No hay EOP para el instante solicitado antes de la cobertura")
            return self._extrapolated(self._samples[0], utc)
        if index >= len(self._timestamps):
            if not self._allow_extrapolation:
                raise EarthOrientationCoverageError("No hay EOP para el instante solicitado después de la cobertura")
            return self._extrapolated(self._samples[-1], utc)
        return self._interpolate(self._samples[index - 1], self._samples[index], utc)

    @staticmethod
    def _extrapolated(sample: EarthOrientation, instant: datetime.datetime) -> EarthOrientation:
        return EarthOrientation(
            dut1_seconds=sample.dut1_seconds,
            xp_radians=sample.xp_radians,
            yp_radians=sample.yp_radians,
            dx_radians=sample.dx_radians,
            dy_radians=sample.dy_radians,
            lod_seconds=sample.lod_seconds,
            source=sample.source,
            version=sample.version,
            quality="extrapolated",
            sampled_at=instant,
            snapshot_id=sample.snapshot_id,
        )

    @staticmethod
    def _interpolate(lower: EarthOrientation, upper: EarthOrientation, instant: datetime.datetime) -> EarthOrientation:
        assert lower.sampled_at is not None and upper.sampled_at is not None
        total_seconds = (upper.sampled_at - lower.sampled_at).total_seconds()
        fraction = (instant - lower.sampled_at).total_seconds() / total_seconds

        def interpolate(name: str) -> float:
            return float(getattr(lower, name)) + fraction * (float(getattr(upper, name)) - float(getattr(lower, name)))

        lod: float | None
        if lower.lod_seconds is None or upper.lod_seconds is None:
            lod = None
        else:
            lod = interpolate("lod_seconds")
        same_source = lower.source == upper.source
        same_version = lower.version == upper.version
        same_snapshot = lower.snapshot_id == upper.snapshot_id
        quality = lower.quality if lower.quality == upper.quality else "interpolated"
        return EarthOrientation(
            dut1_seconds=interpolate("dut1_seconds"),
            xp_radians=interpolate("xp_radians"),
            yp_radians=interpolate("yp_radians"),
            dx_radians=interpolate("dx_radians"),
            dy_radians=interpolate("dy_radians"),
            lod_seconds=lod,
            source=lower.source if same_source else f"{lower.source} → {upper.source}",
            version=lower.version if same_version else f"{lower.version or '?'}→{upper.version or '?'}",
            quality=quality,
            sampled_at=instant,
            snapshot_id=lower.snapshot_id if same_snapshot else None,
        )


class IgsErpEarthOrientationProvider(TabularEarthOrientationProvider):
    """Read a version-2 IGS ERP product as a local EOP provider.

    IGS ERP version 2 stores ``Xpole``/``Ypole`` in :math:`10^{-6}`
    arcseconds and ``UT1-UTC``/``LOD`` in :math:`10^{-7}` seconds.  The
    product does not carry the IERS celestial-pole offsets ``dX``/``dY``;
    Orbit therefore records those values as zero rather than inventing an
    IERS C04 correction.  This is enough for the terrestrial-to-inertial
    rotation used by an SP3 product, while the source and checksum remain
    attached to every transformed state.

    The parser intentionally requires the standard column heading.  A loose
    numeric-table guess can silently interchange ``UT1-UTC`` and a formal
    uncertainty column, which would rotate an orbit into a physically wrong
    inertial position.
    """

    _MICROARCSECONDS_TO_RADIAN = 1.0e-6 * ARCSECOND_TO_RADIAN
    _TENTH_MICROSECONDS_TO_SECONDS = 1.0e-7

    @property
    def snapshot_identity(self) -> EopSnapshotIdentity | None:
        """Return the immutable content identity of the imported ERP."""

        return getattr(self, "_snapshot_identity", None)

    @classmethod
    def from_text(
        cls,
        source_text: str,
        *,
        filename: str = "product.erp",
        source: str = "IGS ERP",
        version: str | None = None,
        quality: str = "final",
        allow_extrapolation: bool = False,
    ) -> "IgsErpEarthOrientationProvider":
        """Parse a text IGS ERP v2 table and retain its SHA-256 identity."""

        if not isinstance(source_text, str) or not source_text.strip():
            raise EopSnapshotValidationError("El fichero ERP está vacío")
        raw = source_text.encode("utf-8")
        lines = source_text.splitlines()
        header_index, columns = cls._header(lines)
        samples: list[EarthOrientation] = []
        previous_mjd: float | None = None
        for line_number, line in enumerate(lines[header_index + 1:], start=header_index + 2):
            stripped = line.strip()
            if not stripped or stripped.startswith(("#", "*", "+", "-", "_")):
                continue
            values = stripped.split()
            # ERP reports often carry a second units heading immediately
            # below the column labels.  It cannot start with a valid MJD.
            if not values or not _looks_like_mjd(values[0]):
                continue
            try:
                mjd = float(values[columns["mjd"]])
                xp = float(values[columns["xp"]])
                yp = float(values[columns["yp"]])
                dut1 = float(values[columns["dut1"]])
                lod = float(values[columns["lod"]])
            except (IndexError, TypeError, ValueError) as exc:
                raise EopSnapshotValidationError(
                    f"El ERP contiene una fila incompleta o no numérica en la línea {line_number}"
                ) from exc
            if not all(math.isfinite(value) for value in (mjd, xp, yp, dut1, lod)):
                raise EopSnapshotValidationError(
                    f"El ERP contiene valores no finitos en la línea {line_number}"
                )
            if mjd < 30_000.0:
                raise EopSnapshotValidationError(
                    f"El MJD ERP no es válido en la línea {line_number}"
                )
            if previous_mjd is not None and mjd <= previous_mjd:
                raise EopSnapshotValidationError(
                    f"El ERP debe estar ordenado cronológicamente sin épocas repetidas (línea {line_number})"
                )
            cls._validate_physical_values(
                xp_microarcseconds=xp,
                yp_microarcseconds=yp,
                dut1_tenth_microseconds=dut1,
                lod_tenth_microseconds=lod,
                line_number=line_number,
            )
            samples.append(EarthOrientation(
                dut1_seconds=dut1 * cls._TENTH_MICROSECONDS_TO_SECONDS,
                xp_radians=xp * cls._MICROARCSECONDS_TO_RADIAN,
                yp_radians=yp * cls._MICROARCSECONDS_TO_RADIAN,
                # The IGS ERP v2 core layout has no dX/dY columns. Keeping
                # zeros explicit prevents it being confused with an IERS C04
                # 2000A correction product.
                dx_radians=0.0,
                dy_radians=0.0,
                lod_seconds=lod * cls._TENTH_MICROSECONDS_TO_SECONDS,
                source=str(source or "IGS ERP").strip() or "IGS ERP",
                version=str(version or filename).strip() or None,
                quality=str(quality or "unknown").strip().lower() or "unknown",
                sampled_at=cls._datetime_from_mjd(mjd),
            ))
            previous_mjd = mjd
        if not samples:
            raise EopSnapshotValidationError("El fichero ERP no contiene registros ERP v2 utilizables")
        ordered = tuple(sorted(samples, key=lambda sample: sample.sampled_at))
        if len({sample.sampled_at for sample in ordered}) != len(ordered):
            raise EopSnapshotValidationError("El ERP contiene épocas MJD duplicadas")
        provider = cls(ordered, allow_extrapolation=allow_extrapolation)
        provider._snapshot_identity = EopSnapshotIdentity(
            filename=str(filename or "product.erp").strip() or "product.erp",
            sha256=hashlib.sha256(raw).hexdigest(),
            byte_size=len(raw),
            record_count=len(ordered),
            coverage_start=ordered[0].sampled_at,  # type: ignore[arg-type]
            coverage_end=ordered[-1].sampled_at,  # type: ignore[arg-type]
        )
        # Rebuild the samples with the portable identity.  The `at` method
        # returns those exact source/version/quality values or their
        # deterministic interpolation.
        provider._samples = tuple(
            EarthOrientation(
                dut1_seconds=sample.dut1_seconds,
                xp_radians=sample.xp_radians,
                yp_radians=sample.yp_radians,
                dx_radians=sample.dx_radians,
                dy_radians=sample.dy_radians,
                lod_seconds=sample.lod_seconds,
                source=sample.source,
                version=sample.version,
                quality=sample.quality,
                sampled_at=sample.sampled_at,
                snapshot_id=provider._snapshot_identity.content_id,
            )
            for sample in ordered
        )
        provider._timestamps = tuple(sample.sampled_at for sample in provider._samples)
        return provider

    @classmethod
    def _validate_physical_values(
        cls,
        *,
        xp_microarcseconds: float,
        yp_microarcseconds: float,
        dut1_tenth_microseconds: float,
        lod_tenth_microseconds: float,
        line_number: int,
    ) -> None:
        """Reject ERP values that cannot plausibly be Earth orientation.

        IGS ERP v2 publishes pole coordinates in microarcseconds and
        ``UT1-UTC``/``LOD`` in 0.1 microseconds.  Keeping this check in those
        native units makes an accidental unit conversion visible at the exact
        source line, before any state or rotation matrix is constructed.
        """

        xp_arcseconds = xp_microarcseconds * 1.0e-6
        yp_arcseconds = yp_microarcseconds * 1.0e-6
        dut1_seconds = dut1_tenth_microseconds * cls._TENTH_MICROSECONDS_TO_SECONDS
        lod_seconds = lod_tenth_microseconds * cls._TENTH_MICROSECONDS_TO_SECONDS
        if abs(xp_arcseconds) > IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS:
            raise EopSnapshotValidationError(
                "El ERP contiene Xpole fuera del rango físico "
                f"de ±{IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS:g} arcsec en la línea {line_number}"
            )
        if abs(yp_arcseconds) > IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS:
            raise EopSnapshotValidationError(
                "El ERP contiene Ypole fuera del rango físico "
                f"de ±{IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS:g} arcsec en la línea {line_number}"
            )
        if abs(dut1_seconds) > IGS_ERP_MAX_ABS_DUT1_SECONDS:
            raise EopSnapshotValidationError(
                "El ERP contiene UT1-UTC fuera del rango físico "
                f"de ±{IGS_ERP_MAX_ABS_DUT1_SECONDS:g} s en la línea {line_number}"
            )
        if abs(lod_seconds) > IGS_ERP_MAX_ABS_LOD_SECONDS:
            raise EopSnapshotValidationError(
                "El ERP contiene LOD fuera del rango físico "
                f"de ±{IGS_ERP_MAX_ABS_LOD_SECONDS:g} s en la línea {line_number}"
            )

    @staticmethod
    def _datetime_from_mjd(mjd: float) -> datetime.datetime:
        return _IGS_ERP_MJD_EPOCH + datetime.timedelta(days=mjd)

    @staticmethod
    def _header(lines: list[str]) -> tuple[int, dict[str, int]]:
        for index, line in enumerate(lines):
            values = line.strip().split()
            if not values:
                continue
            normalized = [_normalise_erp_column(value) for value in values]
            columns: dict[str, int] = {}
            for column_index, value in enumerate(normalized):
                if value == "MJD":
                    columns.setdefault("mjd", column_index)
                elif value in {"XPOLE", "XP", "X"}:
                    columns.setdefault("xp", column_index)
                elif value in {"YPOLE", "YP", "Y"}:
                    columns.setdefault("yp", column_index)
                elif value in {"UT1UTC", "UT1RUTC"}:
                    # Prefer the conventional UT1-UTC solution if both are
                    # present; UT1R-UTC is the conventional fallback.
                    if value == "UT1UTC" or "dut1" not in columns:
                        columns["dut1"] = column_index
                elif value in {"LOD", "LODR"}:
                    if value == "LOD" or "lod" not in columns:
                        columns["lod"] = column_index
            if {"mjd", "xp", "yp", "dut1", "lod"} <= columns.keys():
                return index, columns
        raise EopSnapshotValidationError(
            "El ERP debe declarar las columnas MJD, Xpole, Ypole, UT1-UTC y LOD"
        )


def _normalise_erp_column(value: object) -> str:
    """Normalize a published ERP heading without guessing its meaning."""

    return "".join(character for character in str(value or "").upper() if character.isalnum())


def _looks_like_mjd(value: object) -> bool:
    """Return whether a token can safely begin a modern MJD ERP record."""

    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(numeric) and numeric >= 30_000.0


class IersC04EarthOrientationProvider(TabularEarthOrientationProvider):
    """A local IERS C04/EOP C04 ASCII snapshot provider.

    Two unambiguous IERS layouts are accepted:

    * C04-14 at 0h UTC: ``year month day MJD xp yp UT1-UTC LOD dX dY``;
    * C04-20 at 0h/12h UTC: ``year month day hour MJD xp yp UT1-UTC dX dY
      x-rate y-rate LOD``.

    Both layouts must be the IAU 2000A ``dX/dY`` variant.  Older C04 files
    carrying ``dPsi/dEps`` cannot feed the IAU 2006/2000A CIO reduction and
    are rejected when their header declares that convention. Pole/celestial
    values are in arcseconds and UT1-UTC/LOD are in seconds. A row that is
    neither layout raises rather than being shifted into a physically wrong
    EOP record.
    """

    _C04_14_CORE_COLUMNS = 10
    _C04_20_CORE_COLUMNS = 13
    _C04_20_HOURS = {0, 12}
    _MIN_SUPPORTED_MJD = 30_000.0

    @property
    def snapshot_identity(self) -> EopSnapshotIdentity | None:
        """Return the local-file identity when this provider came from disk."""

        return getattr(self, "_snapshot_identity", None)

    @staticmethod
    def _mjd_at(moment: datetime.datetime) -> float:
        return _MJD_UNIX_EPOCH + (
            (ensure_utc(moment) - datetime.datetime(1970, 1, 1, tzinfo=datetime.UTC)).total_seconds() / 86_400.0
        )

    @classmethod
    def _parse_row(
        cls,
        fields: list[str],
        *,
        line_number: int,
        source: str,
        version: str | None,
        quality: str,
        snapshot_id: str | None = None,
    ) -> EarthOrientation:
        """Parse a C04-14 or C04-20 core record without column guessing."""

        try:
            year, month, day = (int(fields[index]) for index in range(3))
            fourth_column = float(fields[3])
            if not math.isfinite(fourth_column):
                raise ValueError("la cuarta columna no es finita")

            # In C04-14 the fourth column is an MJD (much larger than an
            # hour); in C04-20 it is explicitly HH and the MJD shifts to the
            # fifth column. This remains true when error columns are present.
            if fourth_column >= cls._MIN_SUPPORTED_MJD:
                if len(fields) < cls._C04_14_CORE_COLUMNS:
                    raise ValueError("faltan columnas EOP básicas C04-14")
                mjd = fourth_column
                xp, yp, dut1, lod, dx, dy = (float(fields[index]) for index in range(4, 10))
                sampled_at = datetime.datetime(year, month, day, tzinfo=datetime.UTC)
            else:
                if not fourth_column.is_integer() or int(fourth_column) not in cls._C04_20_HOURS:
                    raise ValueError("la hora C04-20 debe ser 0 o 12")
                if len(fields) < cls._C04_20_CORE_COLUMNS:
                    raise ValueError("faltan columnas EOP básicas C04-20")
                hour = int(fourth_column)
                mjd = float(fields[4])
                xp, yp, dut1, dx, dy = (float(fields[index]) for index in range(5, 10))
                # C04-20 has x/y rates between dY and LOD.
                lod = float(fields[12])
                sampled_at = datetime.datetime(year, month, day, hour, tzinfo=datetime.UTC)
            if not math.isfinite(mjd) or mjd < cls._MIN_SUPPORTED_MJD:
                raise ValueError("el MJD C04 no es válido")
            if not math.isclose(mjd, cls._mjd_at(sampled_at), rel_tol=0.0, abs_tol=5e-7):
                raise ValueError("el MJD C04 no coincide con su fecha UTC")
        except (IndexError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError(
                f"Formato EOP C04 no reconocido en la línea {line_number}; "
                "se espera C04-14 (0h) o C04-20 (0h/12h)"
            ) from exc

        return EarthOrientation(
            dut1_seconds=dut1,
            xp_radians=xp * ARCSECOND_TO_RADIAN,
            yp_radians=yp * ARCSECOND_TO_RADIAN,
            dx_radians=dx * ARCSECOND_TO_RADIAN,
            dy_radians=dy * ARCSECOND_TO_RADIAN,
            lod_seconds=lod,
            source=source,
            version=version,
            quality=quality,
            sampled_at=sampled_at,
            snapshot_id=snapshot_id,
        )

    @classmethod
    def from_text(
        cls,
        text: str,
        *,
        source: str = "IERS EOP C04",
        version: str | None = None,
        quality: str = "final",
        allow_extrapolation: bool = False,
        snapshot_id: str | None = None,
    ) -> "IersC04EarthOrientationProvider":
        samples: list[EarthOrientation] = []
        previous_sampled_at: datetime.datetime | None = None
        for line_number, raw in enumerate(str(text).splitlines(), start=1):
            stripped = raw.strip()
            if not stripped or stripped.startswith(("#", "%", "!")):
                # IERS publishes both IAU 2000A (dX/dY) and legacy IAU 1980
                # (dPsi/dEps) C04 products. The numerical rows have the same
                # shape, so a declared legacy header is the only safe point to
                # reject it before dPsi/dEps are accidentally used as dX/dY.
                normalized_header = re.sub(r"[^a-z]", "", stripped.lower())
                if "dpsi" in normalized_header and "deps" in normalized_header:
                    raise EopSnapshotValidationError(
                        "El snapshot EOP declara dPsi/dEps; Orbit requiere el producto C04 IAU 2000A dX/dY"
                    )
                continue
            fields = stripped.split()
            # IERS snapshots have historically shipped both commented and
            # descriptive plain-text headers.  Skip textual headers, but
            # continue to reject every numeric-looking row that is not one
            # of the two supported C04 layouts.
            if not fields or not fields[0].isdigit():
                normalized_header = re.sub(r"[^a-z]", "", stripped.lower())
                if "dpsi" in normalized_header and "deps" in normalized_header:
                    raise EopSnapshotValidationError(
                        "El snapshot EOP declara dPsi/dEps; Orbit requiere el producto C04 IAU 2000A dX/dY"
                    )
                continue
            sample = cls._parse_row(
                fields,
                line_number=line_number,
                source=source,
                version=version,
                quality=quality,
                snapshot_id=snapshot_id,
            )
            if previous_sampled_at is not None and sample.sampled_at <= previous_sampled_at:
                raise EopSnapshotValidationError(
                    f"El snapshot EOP debe estar ordenado cronológicamente (línea {line_number})"
                )
            samples.append(sample)
            previous_sampled_at = sample.sampled_at
        if not samples:
            raise ValueError("El archivo EOP C04 no contiene filas utilizables")
        return cls(samples, allow_extrapolation=allow_extrapolation)

    @classmethod
    def from_file(
        cls,
        path: str | Path,
        *,
        expected_sha256: str | None = None,
        **kwargs: object,
    ) -> "IersC04EarthOrientationProvider":
        source_path = Path(path)
        try:
            raw = source_path.read_bytes()
        except OSError as exc:
            raise EopSnapshotValidationError(f"No se puede leer el snapshot EOP local: {source_path}") from exc
        digest = hashlib.sha256(raw).hexdigest()
        if expected_sha256 is not None and digest != _normalise_sha256(expected_sha256, label="ORBIT_EOP_C04_SHA256"):
            raise EopSnapshotValidationError(
                "El SHA-256 del snapshot EOP no coincide con ORBIT_EOP_C04_SHA256"
            )
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise EopSnapshotValidationError("El snapshot EOP debe estar codificado en UTF-8/ASCII") from exc
        provider = cls.from_text(
            text,
            version=str(kwargs.pop("version", None) or source_path.name),
            snapshot_id=f"sha256:{digest}",
            **kwargs,
        )
        first, last = provider.samples[0], provider.samples[-1]
        assert first.sampled_at is not None and last.sampled_at is not None
        provider._snapshot_identity = EopSnapshotIdentity(
            filename=source_path.name,
            sha256=digest,
            byte_size=len(raw),
            record_count=len(provider.samples),
            coverage_start=first.sampled_at,
            coverage_end=last.sampled_at,
        )
        return provider

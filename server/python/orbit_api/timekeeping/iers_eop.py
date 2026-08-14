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
                f"{label} EOP C01 fuera del rango físico ±{limit:g} {unit} en la línea {line_number}"
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
    ) -> "IersC01EarthOrientationProvider":
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
    ) -> "IersC01EarthOrientationProvider":
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
    ) -> "IersC01EarthOrientationProvider":
        """Read only a local C01 snapshot; this method never performs I/O over HTTP."""

        source_path = Path(path)
        try:
            raw = source_path.read_bytes()
        except OSError as exc:
            raise EopSnapshotValidationError(f"No se puede leer el snapshot EOP C01 local: {source_path}") from exc
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
            "validationLimits": {
                "polarMotionArcsec": IGS_ERP_MAX_ABS_POLAR_MOTION_ARCSECONDS,
                "dut1Seconds": IERS_C01_MAX_ABS_DUT1_SECONDS,
                "lodSeconds": IERS_C01_MAX_ABS_LOD_SECONDS,
                "celestialPoleArcsec": IERS_C01_MAX_ABS_CELESTIAL_POLE_ARCSECONDS,
            },
            "details": {
                "format": "IERS EOP C01 IAU2000",
                "automatic": self.automatic,
                "usingCachedFallback": self.using_cached_fallback,
                "refreshDue": self.refresh_due,
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
        """Read active EOP or return an explicitly marked visual fallback."""

        with self._state_lock:
            provider = self._provider
        return provider.at(moment) if provider is not None else self._fallback.at(moment)

    def diagnostics(self) -> EopCacheDiagnostics:
        """Read an immutable diagnostic snapshot without touching disk/network."""

        with self._state_lock:
            return self._diagnostics

    def diagnostics_payload(self) -> dict[str, object]:
        return self.diagnostics().payload()

    def refresh_if_needed(self) -> EopCacheDiagnostics:
        """Validate local cache and refresh it if missing/stale, failing closed.

        The previous valid in-memory provider stays active if a new download is
        rejected.  A malformed remote file is never written over the last good
        snapshot.  Concurrent monitor calls collapse to one refresh attempt.
        """

        if not self._refresh_lock.acquire(blocking=False):
            return self.diagnostics()
        try:
            now = ensure_utc(self._now())
            cached_provider, cached_update, cached_error = self._load_cached()
            fresh = cached_provider is not None and cached_update is not None and self._is_fresh(cached_update, now)
            if cached_provider is not None:
                self._install(
                    cached_provider,
                    last_update=cached_update,
                    last_validation=now,
                    status="ok" if fresh else "warning",
                    error=None if fresh else "El snapshot EOP local supera la antigüedad máxima de 7 días.",
                    refresh_due=not fresh,
                    using_cached_fallback=not fresh,
                )
            if fresh:
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
                self._install(
                    provider,
                    last_update=update,
                    last_validation=now,
                    status="ok",
                    error=None,
                    refresh_due=False,
                    using_cached_fallback=False,
                )
                return self.diagnostics()
            except Exception as exc:  # boundary: transport and untrusted remote content
                message = self._safe_error(exc)
                if cached_provider is not None:
                    self._install(
                        cached_provider,
                        last_update=cached_update,
                        last_validation=now,
                        status="warning",
                        error=f"No se pudo actualizar EOP; se conserva la última copia válida: {message}",
                        refresh_due=True,
                        using_cached_fallback=True,
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
            self._install(
                provider,
                last_update=update,
                last_validation=now,
                status="ok" if fresh else "warning",
                error=None if fresh else "El snapshot EOP local supera la antigüedad máxima de 7 días.",
                refresh_due=not fresh,
                using_cached_fallback=not fresh,
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
    ) -> None:
        identity = provider.snapshot_identity
        assert identity is not None
        coverage_warning = not (identity.coverage_start <= last_validation <= identity.coverage_end)
        final_status: EopStatus = "warning" if status == "ok" and coverage_warning else status
        final_error = error
        if coverage_warning and final_error is None:
            final_error = "La fecha actual está fuera de la cobertura EOP disponible."
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
    def _download_https(url: str, timeout_seconds: float, max_bytes: int) -> bytes:
        """Download a bounded HTTPS response using Python's verified TLS stack."""

        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "datacenter.iers.org":
            raise ValueError("La descarga automática EOP solo admite el host HTTPS oficial de IERS")
        if url != IERS_EOP_C01_URL:
            raise ValueError("La descarga automática EOP debe usar la URL oficial EOP_C01_IAU2000")
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
        with build_opener(_RejectRedirects()).open(request, timeout=timeout_seconds) as response:  # noqa: S310 - URL is checked above
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

"""Independent time-scale primitives used by propagation and frame services.

UTC remains Orbit's transport/UI scale, but it is not sufficient for a
high-quality Earth-orientation transformation by itself. This module keeps
the scale conversion rules in one dependency-free boundary.
"""

from __future__ import annotations

import datetime
import hashlib
import math
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


SECONDS_PER_DAY = 86_400.0
JULIAN_DATE_UNIX_EPOCH = 2_440_587.5
_J2000_JULIAN_DATE = 2_451_545.0
_TWO_PI = 2.0 * math.pi


class TimeScale(str, Enum):
    """Time systems accepted by Orbit's native-state and import contracts."""

    UTC = "UTC"
    TAI = "TAI"
    TT = "TT"
    UT1 = "UT1"
    GPS = "GPS"
    GLO = "GLO"
    GAL = "GAL"
    QZS = "QZS"
    BDT = "BDT"
    IRN = "IRN"
    TDB = "TDB"
    TCB = "TCB"
    TCG = "TCG"
    MET = "MET"
    MRT = "MRT"
    SCLK = "SCLK"
    GMST = "GMST"
    UNKNOWN = "UNKNOWN"

    @classmethod
    def from_label(cls, value: str | "TimeScale") -> "TimeScale":
        """Return a known scale without turning unfamiliar labels into UTC."""

        if isinstance(value, cls):
            return value
        label = str(value or "").strip().upper()
        aliases = {
            "GPST": "GPS",
            "GPS_TIME": "GPS",
            "GST": "GAL",
            "GALILEO": "GAL",
            "GLONASST": "GLO",
            "QZSST": "QZS",
            "IRNSST": "IRN",
        }
        return cls._value2member_map_.get(aliases.get(label, label), cls.UNKNOWN)


# Effective UTC instants and their TAI-UTC offset in seconds. The modern UTC
# leap-second definition began on 1972-01-01. Older dates intentionally fail
# instead of being silently modelled with the wrong historical convention.
_TAI_MINUS_UTC = (
    (datetime.datetime(1972, 1, 1, tzinfo=datetime.UTC), 10),
    (datetime.datetime(1972, 7, 1, tzinfo=datetime.UTC), 11),
    (datetime.datetime(1973, 1, 1, tzinfo=datetime.UTC), 12),
    (datetime.datetime(1974, 1, 1, tzinfo=datetime.UTC), 13),
    (datetime.datetime(1975, 1, 1, tzinfo=datetime.UTC), 14),
    (datetime.datetime(1976, 1, 1, tzinfo=datetime.UTC), 15),
    (datetime.datetime(1977, 1, 1, tzinfo=datetime.UTC), 16),
    (datetime.datetime(1978, 1, 1, tzinfo=datetime.UTC), 17),
    (datetime.datetime(1979, 1, 1, tzinfo=datetime.UTC), 18),
    (datetime.datetime(1980, 1, 1, tzinfo=datetime.UTC), 19),
    (datetime.datetime(1981, 7, 1, tzinfo=datetime.UTC), 20),
    (datetime.datetime(1982, 7, 1, tzinfo=datetime.UTC), 21),
    (datetime.datetime(1983, 7, 1, tzinfo=datetime.UTC), 22),
    (datetime.datetime(1985, 7, 1, tzinfo=datetime.UTC), 23),
    (datetime.datetime(1988, 1, 1, tzinfo=datetime.UTC), 24),
    (datetime.datetime(1990, 1, 1, tzinfo=datetime.UTC), 25),
    (datetime.datetime(1991, 1, 1, tzinfo=datetime.UTC), 26),
    (datetime.datetime(1992, 7, 1, tzinfo=datetime.UTC), 27),
    (datetime.datetime(1993, 7, 1, tzinfo=datetime.UTC), 28),
    (datetime.datetime(1994, 7, 1, tzinfo=datetime.UTC), 29),
    (datetime.datetime(1996, 1, 1, tzinfo=datetime.UTC), 30),
    (datetime.datetime(1997, 7, 1, tzinfo=datetime.UTC), 31),
    (datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC), 32),
    (datetime.datetime(2006, 1, 1, tzinfo=datetime.UTC), 33),
    (datetime.datetime(2009, 1, 1, tzinfo=datetime.UTC), 34),
    (datetime.datetime(2012, 7, 1, tzinfo=datetime.UTC), 35),
    (datetime.datetime(2015, 7, 1, tzinfo=datetime.UTC), 36),
    (datetime.datetime(2017, 1, 1, tzinfo=datetime.UTC), 37),
)

_TT_MINUS_TAI_SECONDS = 32.184
_GPS_MINUS_TAI_SECONDS = -19.0
_BDT_MINUS_TAI_SECONDS = -33.0
_NTP_EPOCH = datetime.datetime(1900, 1, 1, tzinfo=datetime.UTC)
_MODERN_UTC_START = datetime.datetime(1972, 1, 1, tzinfo=datetime.UTC)
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class LeapSecondTableError(ValueError):
    """Raised when an operator-provided leap-second snapshot is invalid."""


class LeapSecondTableExpiredError(LeapSecondTableError):
    """Raised when a bounded leap-second snapshot has expired."""


def _normalise_sha256(value: object, *, label: str) -> str:
    digest = str(value or "").strip().lower()
    if digest.startswith("sha256:"):
        digest = digest.removeprefix("sha256:")
    if not _SHA256_PATTERN.fullmatch(digest):
        raise LeapSecondTableError(f"{label} debe ser un SHA-256 hexadecimal de 64 caracteres")
    return digest


@dataclass(frozen=True, slots=True)
class LeapSecondTable:
    """A deterministic table of effective ``TAI - UTC`` offsets.

    ``leap-seconds.list`` snapshots are deliberately loaded by the deployment
    boundary, never fetched by a time conversion.  The table supports the
    IERS/NTP format so an operator can pin both the file hash and its declared
    expiry date alongside an EOP snapshot.
    """

    entries: tuple[tuple[datetime.datetime, int], ...]
    source: str = "IERS leap-seconds.list"
    version: str | None = None
    expires_at: datetime.datetime | None = None
    sha256: str | None = None

    def __post_init__(self) -> None:
        normalised: list[tuple[datetime.datetime, int]] = []
        previous: datetime.datetime | None = None
        previous_offset: int | None = None
        for raw_effective, raw_offset in self.entries:
            effective = ensure_utc(raw_effective)
            if effective < _MODERN_UTC_START:
                raise LeapSecondTableError("La tabla de segundos intercalares debe comenzar en UTC moderno (1972 o posterior)")
            try:
                offset_number = float(raw_offset)
            except (TypeError, ValueError) as exc:
                raise LeapSecondTableError("TAI-UTC debe ser un número entero de segundos") from exc
            if isinstance(raw_offset, bool) or not math.isfinite(offset_number) or not offset_number.is_integer():
                raise LeapSecondTableError("TAI-UTC debe ser un número entero de segundos")
            offset = int(offset_number)
            if offset < 10:
                raise LeapSecondTableError("TAI-UTC no puede ser menor que 10 s en UTC moderno")
            if previous is not None and effective <= previous:
                raise LeapSecondTableError("Las entradas de segundos intercalares deben estar en orden cronológico estricto")
            # A future negative leap second is possible in principle, so both
            # directions of exactly one second remain valid.
            if previous_offset is not None and abs(offset - previous_offset) != 1:
                raise LeapSecondTableError("Cada cambio de TAI-UTC debe diferir exactamente en un segundo")
            normalised.append((effective, offset))
            previous, previous_offset = effective, offset
        if not normalised:
            raise LeapSecondTableError("La tabla de segundos intercalares no contiene entradas")
        source = str(self.source or "").strip()
        if not source:
            raise LeapSecondTableError("La fuente de segundos intercalares es obligatoria")
        version = None if self.version is None else str(self.version).strip() or None
        expires_at = ensure_utc(self.expires_at) if self.expires_at is not None else None
        if expires_at is not None and expires_at <= normalised[-1][0]:
            raise LeapSecondTableError("La caducidad de leap seconds debe ser posterior a la última entrada")
        digest = _normalise_sha256(self.sha256, label="El SHA-256 de leap seconds") if self.sha256 is not None else None
        object.__setattr__(self, "entries", tuple(normalised))
        object.__setattr__(self, "source", source)
        object.__setattr__(self, "version", version)
        object.__setattr__(self, "expires_at", expires_at)
        object.__setattr__(self, "sha256", digest)

    @property
    def identity_token(self) -> tuple[str, str | None, str | None]:
        """Stable provenance token for caches, manifests and diagnostics."""

        return self.source, self.version, self.sha256

    @property
    def last_effective_at(self) -> datetime.datetime:
        """Return the most recent instant at which the table changed."""

        return self.entries[-1][0]

    def tai_minus_utc(self, moment: datetime.datetime) -> int:
        """Return the applicable modern ``TAI - UTC`` offset in seconds."""

        utc = ensure_utc(moment)
        for effective, offset in reversed(self.entries):
            if utc >= effective:
                return offset
        raise ValueError("Las conversiones TAI anteriores a 1972 requieren una tabla histórica explícita")

    def require_current(self, moment: datetime.datetime | None = None) -> None:
        """Reject a list whose publisher-declared validity horizon elapsed."""

        instant = ensure_utc(moment or utc_now())
        if self.expires_at is None:
            raise LeapSecondTableExpiredError("La tabla local de leap seconds no declara fecha de caducidad")
        if instant >= self.expires_at:
            raise LeapSecondTableExpiredError(
                f"La tabla local de leap seconds caducó el {self.expires_at.isoformat()}"
            )

    def require_coverage(
        self,
        moment: datetime.datetime,
        *,
        require_unexpired: bool = False,
    ) -> None:
        """Ensure this table can represent a requested UTC instant.

        A truncated local list is not a historical UTC model: converting an
        epoch before its first effective ``TAI-UTC`` entry would otherwise
        fail later, deep inside a frame reduction.  When precision policy also
        requires a publisher validity horizon, the upper bound is the IERS/NTP
        ``#@`` instant and is exclusive, matching :meth:`require_current`.
        """

        instant = ensure_utc(moment)
        first_effective = self.entries[0][0]
        if instant < first_effective:
            raise LeapSecondTableError(
                "La tabla local de leap seconds no cubre el instante solicitado: "
                f"comienza en {first_effective.isoformat()}"
            )
        if require_unexpired:
            self.require_current(instant)

    @classmethod
    def from_iers_text(
        cls,
        text: str,
        *,
        source: str = "IERS leap-seconds.list",
        version: str | None = None,
        sha256: str | None = None,
    ) -> "LeapSecondTable":
        """Parse an IERS/NTP ``leap-seconds.list`` snapshot without I/O."""

        entries: list[tuple[datetime.datetime, int]] = []
        expires_at: datetime.datetime | None = None
        for line_number, raw_line in enumerate(str(text).splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#@"):
                fields = line[2:].strip().split()
                if len(fields) != 1 or not fields[0].isdigit():
                    raise LeapSecondTableError(f"Caducidad inválida en leap-seconds.list, línea {line_number}")
                expires_at = _NTP_EPOCH + datetime.timedelta(seconds=int(fields[0]))
                continue
            if line.startswith("#"):
                continue
            fields = line.split("#", maxsplit=1)[0].split()
            if len(fields) != 2 or not all(field.isdigit() for field in fields):
                raise LeapSecondTableError(f"Formato inválido de leap-seconds.list en la línea {line_number}")
            effective = _NTP_EPOCH + datetime.timedelta(seconds=int(fields[0]))
            entries.append((effective, int(fields[1])))
        return cls(
            entries=tuple(entries),
            source=source,
            version=version,
            expires_at=expires_at,
            sha256=sha256,
        )

    @classmethod
    def from_file(
        cls,
        path: str | Path,
        *,
        source: str = "IERS leap-seconds.list",
        version: str | None = None,
        expected_sha256: str | None = None,
    ) -> "LeapSecondTable":
        """Load and verify one local leap-second snapshot.

        This method intentionally opens only the supplied local path.  It does
        not contact IERS/NTP or attempt a background refresh.
        """

        source_path = Path(path).expanduser()
        try:
            raw = source_path.read_bytes()
        except OSError as exc:
            raise LeapSecondTableError(f"No se puede leer la tabla local de leap seconds: {source_path}") from exc
        digest = hashlib.sha256(raw).hexdigest()
        if expected_sha256 is not None and digest != _normalise_sha256(expected_sha256, label="ORBIT_LEAP_SECONDS_SHA256"):
            raise LeapSecondTableError("El SHA-256 de la tabla local de leap seconds no coincide con ORBIT_LEAP_SECONDS_SHA256")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise LeapSecondTableError("La tabla local de leap seconds debe estar codificada en UTF-8/ASCII") from exc
        return cls.from_iers_text(
            text,
            source=source,
            version=version or source_path.name,
            sha256=digest,
        )


def ensure_utc(moment: datetime.datetime) -> datetime.datetime:
    """Return an aware UTC datetime, treating naive values as UTC.

    Orbit historically accepted naive request timestamps as UTC. Keeping that
    compatibility at this transport boundary makes downstream frame code
    explicit without changing existing API clients.
    """

    if not isinstance(moment, datetime.datetime):
        raise ValueError("El instante debe ser una fecha y hora")
    return moment.replace(tzinfo=datetime.UTC) if moment.tzinfo is None else moment.astimezone(datetime.UTC)


def utc_now() -> datetime.datetime:
    """Return the current aware UTC instant."""

    return datetime.datetime.now(datetime.UTC)


BUILTIN_LEAP_SECOND_TABLE = LeapSecondTable(
    entries=_TAI_MINUS_UTC,
    source="IERS historical leap-second schedule bundled with Orbit",
    version="2017-01-01",
)
_default_leap_second_table = BUILTIN_LEAP_SECOND_TABLE


def default_leap_second_table() -> LeapSecondTable:
    """Return the immutable table used by the compatibility conversion API."""

    return _default_leap_second_table


def configure_default_leap_second_table(table: LeapSecondTable) -> LeapSecondTable:
    """Set the process-startup leap-second table without performing network I/O."""

    if not isinstance(table, LeapSecondTable):
        raise TypeError("La tabla de segundos intercalares debe ser LeapSecondTable")
    global _default_leap_second_table
    _default_leap_second_table = table
    return table


def _leap_table(table: LeapSecondTable | None) -> LeapSecondTable:
    return table or _default_leap_second_table


def _finite_dut1(value: object) -> float:
    try:
        dut1 = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("DUT1 debe ser un número de segundos") from exc
    if not math.isfinite(dut1):
        raise ValueError("DUT1 debe ser finito")
    return dut1


def tai_minus_utc(
    moment: datetime.datetime,
    *,
    leap_seconds: LeapSecondTable | None = None,
) -> int:
    """Return the applicable modern ``TAI - UTC`` offset in seconds.

    Existing callers use Orbit's process-startup table. Importers or tests can
    instead inject a pinned table without mutating global state.
    """

    return _leap_table(leap_seconds).tai_minus_utc(moment)


def utc_to_tai(
    moment: datetime.datetime,
    *,
    leap_seconds: LeapSecondTable | None = None,
) -> datetime.datetime:
    """Return the TAI calendar representation of a UTC instant."""

    utc = ensure_utc(moment)
    return utc + datetime.timedelta(seconds=tai_minus_utc(utc, leap_seconds=leap_seconds))


def tai_to_utc(
    moment: datetime.datetime,
    *,
    leap_seconds: LeapSecondTable | None = None,
) -> datetime.datetime:
    """Return UTC from a modern TAI calendar representation.

    Python cannot label the leap second ``23:59:60`` itself. Ordinary
    ephemeris epochs are unambiguous and are handled exactly.
    """

    table = _leap_table(leap_seconds)
    tai = ensure_utc(moment)
    for effective, offset in reversed(table.entries):
        candidate = tai - datetime.timedelta(seconds=offset)
        if candidate >= effective and table.tai_minus_utc(candidate) == offset:
            return candidate
    raise ValueError("La fecha TAI no se puede convertir con la tabla de segundos intercalares disponible")


def utc_to_tt(
    moment: datetime.datetime,
    *,
    leap_seconds: LeapSecondTable | None = None,
) -> datetime.datetime:
    """Return the TT calendar representation of a UTC instant."""

    return utc_to_tai(moment, leap_seconds=leap_seconds) + datetime.timedelta(seconds=_TT_MINUS_TAI_SECONDS)


def tt_to_utc(
    moment: datetime.datetime,
    *,
    leap_seconds: LeapSecondTable | None = None,
) -> datetime.datetime:
    """Return UTC from a TT calendar representation."""

    return tai_to_utc(
        ensure_utc(moment) - datetime.timedelta(seconds=_TT_MINUS_TAI_SECONDS),
        leap_seconds=leap_seconds,
    )


def utc_to_ut1(moment: datetime.datetime, *, dut1_seconds: float = 0.0) -> datetime.datetime:
    """Convert UTC to UT1 using the supplied DUT1 correction in seconds."""

    return ensure_utc(moment) + datetime.timedelta(seconds=_finite_dut1(dut1_seconds))


def to_utc(
    moment: datetime.datetime,
    time_scale: TimeScale | str,
    *,
    dut1_seconds: float | None = None,
    leap_seconds: LeapSecondTable | None = None,
) -> datetime.datetime:
    """Convert an imported epoch into UTC without guessing an unknown scale."""

    scale = TimeScale.from_label(time_scale)
    if scale is TimeScale.UTC:
        return ensure_utc(moment)
    if scale is TimeScale.TAI:
        return tai_to_utc(moment, leap_seconds=leap_seconds)
    if scale is TimeScale.TT:
        return tt_to_utc(moment, leap_seconds=leap_seconds)
    if scale in {TimeScale.GPS, TimeScale.GAL, TimeScale.QZS}:
        return tai_to_utc(
            ensure_utc(moment) - datetime.timedelta(seconds=_GPS_MINUS_TAI_SECONDS),
            leap_seconds=leap_seconds,
        )
    if scale is TimeScale.BDT:
        return tai_to_utc(
            ensure_utc(moment) - datetime.timedelta(seconds=_BDT_MINUS_TAI_SECONDS),
            leap_seconds=leap_seconds,
        )
    if scale is TimeScale.GLO:
        # SP3 GLO convention is a UTC-family civil scale offset by +3 h.
        return ensure_utc(moment) - datetime.timedelta(hours=3)
    if scale is TimeScale.UT1:
        if dut1_seconds is None:
            raise ValueError("UT1 requiere DUT1 para convertirse a UTC")
        return ensure_utc(moment) - datetime.timedelta(seconds=_finite_dut1(dut1_seconds))
    raise ValueError(f"La escala temporal {scale.value} requiere una correlación de origen explícita")


def from_utc(
    moment: datetime.datetime,
    time_scale: TimeScale | str,
    *,
    dut1_seconds: float | None = None,
    leap_seconds: LeapSecondTable | None = None,
) -> datetime.datetime:
    """Render a UTC instant in an explicitly requested supported scale."""

    scale = TimeScale.from_label(time_scale)
    utc = ensure_utc(moment)
    if scale is TimeScale.UTC:
        return utc
    if scale is TimeScale.TAI:
        return utc_to_tai(utc, leap_seconds=leap_seconds)
    if scale is TimeScale.TT:
        return utc_to_tt(utc, leap_seconds=leap_seconds)
    if scale in {TimeScale.GPS, TimeScale.GAL, TimeScale.QZS}:
        return utc_to_tai(utc, leap_seconds=leap_seconds) + datetime.timedelta(seconds=_GPS_MINUS_TAI_SECONDS)
    if scale is TimeScale.BDT:
        return utc_to_tai(utc, leap_seconds=leap_seconds) + datetime.timedelta(seconds=_BDT_MINUS_TAI_SECONDS)
    if scale is TimeScale.GLO:
        return utc + datetime.timedelta(hours=3)
    if scale is TimeScale.UT1:
        if dut1_seconds is None:
            raise ValueError("UT1 requiere DUT1 para convertirse desde UTC")
        return utc_to_ut1(utc, dut1_seconds=_finite_dut1(dut1_seconds))
    raise ValueError(f"La escala temporal {scale.value} requiere una correlación de destino explícita")


def julian_date(moment: datetime.datetime) -> float:
    """Return the Julian Date for an aware/naive UTC-like instant."""

    unix_seconds = (ensure_utc(moment) - datetime.datetime(1970, 1, 1, tzinfo=datetime.UTC)).total_seconds()
    return JULIAN_DATE_UNIX_EPOCH + (unix_seconds / SECONDS_PER_DAY)


def gmst_rad(moment: datetime.datetime, *, dut1_seconds: float = 0.0) -> float:
    """Return a legacy GMST angle in radians from UTC plus DUT1.

    This IAU-82-compatible path is retained for TEME/SGP4. Modern GCRF/ITRF
    transformations use the IAU 2006/2000A route in ``orbit_api.frames``.
    """

    centuries = (julian_date(utc_to_ut1(moment, dut1_seconds=dut1_seconds)) - _J2000_JULIAN_DATE) / 36_525.0
    seconds = (
        67_310.54841
        + (876_600.0 * 3_600.0 + 8_640_184.812866) * centuries
        + 0.093104 * (centuries ** 2)
        - 6.2e-6 * (centuries ** 3)
    )
    radians = math.fmod(math.radians(seconds / 240.0), _TWO_PI)
    return radians + _TWO_PI if radians < 0.0 else radians

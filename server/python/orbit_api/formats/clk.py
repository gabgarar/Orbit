"""RINEX clock-product parsing for precise GNSS ephemerides.

Orbit deliberately keeps clock products separate from the Cartesian SP3
states.  A CLK record is a clock solution, not a position/velocity sample,
and turning it into a synthetic orbital state would lose both its units and
its provenance.  The importer associates ``AS`` (satellite clock) records
with an SP3 product by GNSS satellite identifier while retaining the RINEX
time-system declaration.
"""

from __future__ import annotations

import datetime
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from itertools import pairwise
from types import MappingProxyType

from orbit_api.timekeeping import TimeScale

from .metadata import EphemerisFormatError

_CLOCK_RECORD = re.compile(
    r"^\s*(?P<kind>AS|AR|CR|DR)\s+"
    r"(?P<identifier>\S+)\s+"
    r"(?P<year>\d{2,4})\s+"
    r"(?P<month>\d{1,2})\s+"
    r"(?P<day>\d{1,2})\s+"
    r"(?P<hour>\d{1,2})\s+"
    r"(?P<minute>\d{1,2})\s+"
    r"(?P<second>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[DEde][+-]?\d+)?)\s+"
    r"(?P<count>\d+)"
    r"(?:\s+(?P<values>.*))?$"
)


@dataclass(frozen=True, slots=True)
class RinexClockMetadata:
    """File-level RINEX clock provenance.

    ``time_scale`` may be :attr:`~orbit_api.timekeeping.TimeScale.UNKNOWN`.
    That is intentionally preserved instead of assuming UTC: a clock product
    with no declared time-system can still be stored and audited, but Orbit
    never uses it to silently shift an SP3 epoch.
    """

    version: str
    file_type: str | None
    time_scale: TimeScale
    time_scale_label: str | None
    agency: str | None

    @property
    def format_name(self) -> str:
        return "CLK"


@dataclass(frozen=True, slots=True)
class ClockSample:
    """One satellite-clock solution in SI seconds.

    ``bias_seconds`` is the first value on an ``AS`` record.  ``drift`` and
    ``drift_rate`` are populated only when the record declares them.  The
    optional sigma values are retained exactly as the RINEX quantities in
    seconds, seconds/second and seconds/second² respectively.
    """

    satellite_id: str
    epoch: datetime.datetime
    time_scale: TimeScale
    bias_seconds: float
    bias_sigma_seconds: float | None = None
    drift_seconds_per_second: float | None = None
    drift_sigma_seconds_per_second: float | None = None
    drift_rate_seconds_per_second2: float | None = None
    drift_rate_sigma_seconds_per_second2: float | None = None


@dataclass(frozen=True, slots=True)
class RinexClockProduct:
    """Parsed RINEX CLK satellite records grouped by identifier."""

    metadata: RinexClockMetadata
    satellites: Mapping[str, tuple[ClockSample, ...]]

    def __post_init__(self) -> None:
        normalized: dict[str, tuple[ClockSample, ...]] = {}
        for satellite_id, samples in self.satellites.items():
            identifier = _satellite_id(satellite_id)
            ordered = tuple(sorted(samples, key=lambda sample: sample.epoch))
            if not ordered:
                continue
            if any(sample.satellite_id != identifier for sample in ordered):
                raise EphemerisFormatError("Los identificadores de reloj RINEX no coinciden")
            if any(left.epoch == right.epoch for left, right in pairwise(ordered)):
                raise EphemerisFormatError(
                    f"CLK contiene épocas duplicadas para el satélite {identifier}"
                )
            normalized[identifier] = ordered
        object.__setattr__(self, "satellites", MappingProxyType(normalized))

    @property
    def satellite_ids(self) -> tuple[str, ...]:
        return tuple(self.satellites)

    @property
    def sample_count(self) -> int:
        return sum(len(samples) for samples in self.satellites.values())

    @property
    def coverage_start(self) -> datetime.datetime | None:
        samples = tuple(sample for values in self.satellites.values() for sample in values)
        return min((sample.epoch for sample in samples), default=None)

    @property
    def coverage_end(self) -> datetime.datetime | None:
        samples = tuple(sample for values in self.satellites.values() for sample in values)
        return max((sample.epoch for sample in samples), default=None)

    def samples_for_satellite(self, satellite_id: str) -> tuple[ClockSample, ...]:
        return self.satellites.get(_satellite_id(satellite_id), ())


def parse_rinex_clock_metadata(source: str | Iterable[str]) -> RinexClockMetadata:
    """Parse the declared RINEX CLK header without consuming its records."""

    lines = _source_lines(source)
    header_lines = _header_lines(lines)
    version_line = next((line for line in header_lines if "RINEX VERSION / TYPE" in line), None)
    if version_line is None:
        raise EphemerisFormatError("El fichero CLK no declara RINEX VERSION / TYPE")
    version = version_line[:9].strip()
    if not version:
        raise EphemerisFormatError("La versión RINEX CLK no es válida")
    try:
        float(version)
    except ValueError as exc:
        raise EphemerisFormatError("La versión RINEX CLK no es válida") from exc

    type_column = version_line[20:21].strip().upper()
    # Most modern files use C in the conventional type slot.  Do not reject a
    # vendor file merely because it uses a wider header layout: records are
    # still checked independently below.
    file_type = type_column or None
    time_line = next((line for line in header_lines if "TIME SYSTEM ID" in line), None)
    time_label = time_line[:60].strip().split()[0] if time_line else None
    agency_line = next((line for line in header_lines if "PGM / RUN BY / DATE" in line), None)
    agency = agency_line[20:40].strip() if agency_line else None
    return RinexClockMetadata(
        version=version,
        file_type=file_type,
        time_scale=TimeScale.from_label(time_label),
        time_scale_label=time_label.upper() if time_label else None,
        agency=agency or None,
    )


def parse_rinex_clock_product(source: str | Iterable[str]) -> RinexClockProduct:
    """Read satellite ``AS`` records from a RINEX CLK product.

    Receiver (``AR``) and analysis-centre (``CR``/``DR``) records are not
    discarded as malformed; they are simply outside Orbit's per-satellite
    precise-product association and therefore remain unmodelled for now.
    """

    lines = _source_lines(source)
    metadata = parse_rinex_clock_metadata(lines)
    _header_lines(lines)  # Validate END OF HEADER before accepting records.
    samples_by_satellite: dict[str, list[ClockSample]] = {}
    header_finished = False
    for line in lines:
        if not header_finished:
            if "END OF HEADER" in line:
                header_finished = True
            continue
        if not line.strip():
            continue
        match = _CLOCK_RECORD.match(line)
        if match is None:
            # RINEX permits continuation lines for long records.  Values used
            # here all fit on the primary AS line; a continuation is only
            # relevant to extra diagnostics Orbit does not yet model.
            continue
        if match.group("kind") != "AS":
            continue
        satellite_id = _satellite_id(match.group("identifier"))
        values = _numeric_values(match.group("values") or "")
        count = int(match.group("count"))
        if count < 1 or not values:
            raise EphemerisFormatError(
                f"CLK AS para {satellite_id} no declara el sesgo de reloj"
            )
        if len(values) < min(count, 1):
            raise EphemerisFormatError(
                f"CLK AS para {satellite_id} está incompleto"
            )
        epoch = _record_epoch(match)
        samples_by_satellite.setdefault(satellite_id, []).append(
            ClockSample(
                satellite_id=satellite_id,
                epoch=epoch,
                time_scale=metadata.time_scale,
                bias_seconds=values[0],
                bias_sigma_seconds=values[1] if len(values) > 1 else None,
                drift_seconds_per_second=values[2] if len(values) > 2 else None,
                drift_sigma_seconds_per_second=values[3] if len(values) > 3 else None,
                drift_rate_seconds_per_second2=values[4] if len(values) > 4 else None,
                drift_rate_sigma_seconds_per_second2=values[5] if len(values) > 5 else None,
            )
        )
    return RinexClockProduct(metadata=metadata, satellites=samples_by_satellite)


def _source_lines(source: str | Iterable[str]) -> tuple[str, ...]:
    if isinstance(source, str):
        lines = source.lstrip("\ufeff").splitlines()
    else:
        try:
            lines = [str(line).rstrip("\r\n") for line in source]
        except TypeError as exc:
            raise EphemerisFormatError("El contenido CLK debe ser texto o líneas de texto") from exc
    if not lines:
        raise EphemerisFormatError("El contenido CLK está vacío")
    return tuple(lines)


def _header_lines(lines: tuple[str, ...]) -> tuple[str, ...]:
    header: list[str] = []
    for line in lines:
        header.append(line)
        if "END OF HEADER" in line:
            return tuple(header)
    raise EphemerisFormatError("El fichero CLK no contiene END OF HEADER")


def _numeric_values(value: str) -> tuple[float, ...]:
    values: list[float] = []
    for raw in value.split():
        try:
            values.append(float(raw.replace("D", "E").replace("d", "e")))
        except ValueError as exc:
            raise EphemerisFormatError("CLK contiene un valor numérico inválido") from exc
    return tuple(values)


def _record_epoch(match: re.Match[str]) -> datetime.datetime:
    year = int(match.group("year"))
    if year < 100:
        year += 2000 if year < 80 else 1900
    try:
        second = float(match.group("second").replace("D", "E").replace("d", "e"))
        base = datetime.datetime(
            year,
            int(match.group("month")),
            int(match.group("day")),
            int(match.group("hour")),
            int(match.group("minute")),
            tzinfo=datetime.UTC,
        )
        return base + datetime.timedelta(seconds=second)
    except (TypeError, ValueError, OverflowError) as exc:
        raise EphemerisFormatError("La época de un registro CLK no es válida") from exc


def _satellite_id(value: str) -> str:
    identifier = str(value or "").strip().upper()
    if not identifier:
        raise EphemerisFormatError("El identificador de satélite CLK es obligatorio")
    return identifier

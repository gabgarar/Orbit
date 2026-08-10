"""SP3 metadata and native tabulated-state readers.

The parser retains the fixed-width header's frame/time provenance and the
state adapter reads P/V samples without applying a display-frame conversion.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from types import MappingProxyType

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import TimeScale, utc_now

from .metadata import EphemerisFormatError, Sp3Metadata, parse_reference_frame
from .tabular import TabularStateProvider, source_epoch

_SP3_MISSING_COMPONENT = 999_999.0

# IGS SP3 position records are normally separated by minutes.  Treating that
# cadence as piecewise-linear is visibly and numerically inadequate for
# sub-minute requests such as AOS/LOS and range calculations.  A centred
# ninth-degree Lagrange polynomial (ten records) is the conventional bounded
# SP3 interpolation policy; shorter test, partial, or near-real-time files
# use the highest degree their available records support.  The provider never
# extrapolates outside its declared coverage.
SP3_INTERPOLATION_METHOD = "LAGRANGE"
SP3_MAX_INTERPOLATION_DEGREE = 9


@dataclass(frozen=True, slots=True)
class Sp3ClockSample:
    """Clock correction carried alongside one SP3 state record.

    SP3 position records carry a clock correction in microseconds and SP3
    velocity records carry its rate in :math:`10^{-4}` microseconds per
    second.  They are not Cartesian state components, so Orbit stores them as
    a separate product rather than pretending they are part of a velocity
    vector.  RINEX CLK remains the richer companion clock format.
    """

    satellite_id: str
    epoch: datetime.datetime
    bias_seconds: float | None = None
    rate_seconds_per_second: float | None = None


@dataclass(frozen=True, slots=True)
class Sp3StateProvider:
    """Native, tabulated SP3 states grouped by satellite identifier.

    SP3 files may contain many satellites.  Each child
    :class:`TabularStateProvider` keeps the shared header's coordinate-system
    label and time scale instead of converting samples to an Orbit display
    frame during ingestion.
    """

    metadata: Sp3Metadata
    satellites: Mapping[str, TabularStateProvider]
    clock_samples: Mapping[str, tuple[Sp3ClockSample, ...]] = field(default_factory=dict)
    frame_transformer: FrameTransformService | None = None

    def __post_init__(self) -> None:
        providers = {
            _satellite_id(identifier): provider
            for identifier, provider in self.satellites.items()
        }
        if not providers:
            raise EphemerisFormatError("El fichero SP3 no contiene estados de posición utilizables")
        if any(not isinstance(provider, TabularStateProvider) for provider in providers.values()):
            raise EphemerisFormatError("Los estados SP3 deben usar proveedores tabulados")
        transformer = self.frame_transformer or FrameTransformService()
        # The parent service is the numerical contract for this entire SP3.
        # Rebuild direct-construction children around it so UTC/TAI conversion
        # during interpolation cannot use one leap-second snapshot while a
        # subsequent frame transform uses another.
        aligned_providers = {
            identifier: replace(provider, frame_transformer=transformer)
            for identifier, provider in providers.items()
        }
        object.__setattr__(self, "satellites", MappingProxyType(aligned_providers))
        normalized_clock_samples: dict[str, tuple[Sp3ClockSample, ...]] = {}
        for identifier, samples in self.clock_samples.items():
            satellite_id = _satellite_id(identifier)
            ordered = tuple(sorted(samples, key=lambda sample: sample.epoch))
            if any(sample.satellite_id != satellite_id for sample in ordered):
                raise EphemerisFormatError("Los relojes SP3 no coinciden con su satélite")
            normalized_clock_samples[satellite_id] = ordered
        object.__setattr__(self, "clock_samples", MappingProxyType(normalized_clock_samples))
        object.__setattr__(self, "frame_transformer", transformer)

    @classmethod
    def from_text(
        cls,
        source: str | Iterable[str],
        *,
        frame_transformer: FrameTransformService | None = None,
    ) -> Sp3StateProvider:
        """Read SP3 samples into per-satellite native-state adapters."""

        lines = _source_lines(source)
        metadata = parse_sp3_metadata(lines)
        if metadata.time_scale is TimeScale.UNKNOWN:
            raise EphemerisFormatError(
                f"SP3 declara una escala temporal no soportada: {metadata.time_scale_label}"
            )

        positions, velocities = _sp3_records(lines)
        clock_samples = _sp3_clock_samples(lines)
        samples_by_satellite: dict[str, list[StateVector]] = {}
        for (epoch, satellite_id), position_km in positions.items():
            velocity_dm_s = velocities.get((epoch, satellite_id))
            provenance = {
                "source_format": "SP3",
                "satellite_id": satellite_id,
                "sp3_version": metadata.version,
                "coordinate_system": metadata.reference_frame.label,
                "time_system": metadata.time_scale_label,
                "agency": metadata.agency,
            }
            # The lookup key remains the raw SP3 calendar epoch; the emitted
            # Sp3ClockSample carries the aware source-epoch carrier just like
            # the corresponding StateVector below.
            clock = clock_samples.get(satellite_id, {}).get(epoch)
            if clock is not None:
                if clock.bias_seconds is not None:
                    provenance["sp3_clock_bias_seconds"] = clock.bias_seconds
                if clock.rate_seconds_per_second is not None:
                    provenance["sp3_clock_rate_seconds_per_second"] = clock.rate_seconds_per_second
            sample = StateVector(
                epoch=source_epoch(epoch),
                time_scale=metadata.time_scale,
                frame=metadata.reference_frame.family,
                frame_realization=metadata.reference_frame.realization,
                center="EARTH",
                position_m=tuple(component * 1_000.0 for component in position_km),
                # SP3 velocity records use decimetres per second, unlike the
                # position records (kilometres). Keep the source unit rule at
                # this boundary so all StateVector values are SI.
                velocity_m_s=(
                    tuple(component * 0.1 for component in velocity_dm_s)
                    if velocity_dm_s is not None
                    else None
                ),
                provenance=provenance,
            )
            samples_by_satellite.setdefault(satellite_id, []).append(sample)

        transformer = frame_transformer or FrameTransformService()
        providers = {
            satellite_id: _sp3_tabular_provider(
                samples=tuple(samples),
                frame_transformer=transformer,
            )
            for satellite_id, samples in samples_by_satellite.items()
        }
        clocks_by_satellite = {
            satellite_id: tuple(
                clock_by_epoch[epoch]
                for epoch in sorted(clock_by_epoch)
            )
            for satellite_id, clock_by_epoch in clock_samples.items()
        }
        return cls(
            metadata=metadata,
            satellites=providers,
            clock_samples=clocks_by_satellite,
            frame_transformer=transformer,
        )

    @property
    def satellite_ids(self) -> tuple[str, ...]:
        """Return the normalized identifiers represented by this SP3 file."""

        return tuple(self.satellites)

    @property
    def clock_sample_count(self) -> int:
        """Return the number of usable embedded SP3 clock corrections."""

        return sum(len(samples) for samples in self.clock_samples.values())

    def for_satellite(self, satellite_id: str) -> TabularStateProvider:
        """Return the native adapter for one SP3 satellite record series."""

        identifier = _satellite_id(satellite_id)
        try:
            return self.satellites[identifier]
        except KeyError as exc:
            raise EphemerisFormatError(f"SP3 no contiene el satélite {identifier}") from exc

    def native_state_at(
        self,
        instant: datetime.datetime,
        *,
        satellite_id: str | None = None,
        time_scale: TimeScale | str = TimeScale.UTC,
    ) -> StateVector:
        """Return an SP3 state in its declared native frame/time contract.

        A multi-satellite SP3 needs ``satellite_id``. A single-satellite file
        can satisfy the normal ``OrbitPropagator.native_state_at(instant)``
        shape without any additional selector.
        """

        return self._selected_satellite(satellite_id).native_state_at(instant, time_scale=time_scale)

    def state_at(
        self,
        instant: datetime.datetime,
        *,
        target_frame: FrameId | str = FrameId.ITRF,
        target_realization: str | None = None,
        satellite_id: str | None = None,
        time_scale: TimeScale | str = TimeScale.UTC,
    ) -> StateVector:
        """Return a requested target-frame view of one SP3 state series."""

        return self._selected_satellite(satellite_id).state_at(
            instant,
            target_frame=target_frame,
            target_realization=target_realization,
            time_scale=time_scale,
        )

    @property
    def dynamics_reference_frame(self) -> str:
        return self.metadata.reference_frame.family

    @property
    def dynamics_reference_realization(self) -> str | None:
        return self.metadata.reference_frame.realization

    @property
    def ephemeris_reference_frame(self) -> str:
        """Return the exact terrestrial frame declared by the SP3 header.

        ``IGS20``/``IGb20``/``IGc20`` are not aliases for a renderer ITRF
        realization.  The renderer may request ITRF only through an explicit
        realization operation, so this property remains source-native even
        when a deployment has opted into such an operation.
        """

        return self.metadata.reference_frame.label

    @property
    def ephemeris_reference_realization(self) -> str | None:
        return self.metadata.reference_frame.realization

    def _selected_satellite(self, satellite_id: str | None) -> TabularStateProvider:
        if satellite_id is None:
            if len(self.satellites) != 1:
                raise EphemerisFormatError(
                    "SP3 contiene varios satélites; selecciona satellite_id para evitar mezclar estados"
                )
            return next(iter(self.satellites.values()))
        return self.for_satellite(satellite_id)

    def propagate_datetime(
        self,
        instant: datetime.datetime,
        *,
        satellite_id: str | None = None,
    ) -> tuple[float, float, float, float, float, float]:
        """Legacy ITRF component adapter for a selected SP3 satellite."""

        return self.state_at(instant, satellite_id=satellite_id).components()

    def propagate(self, *, satellite_id: str | None = None) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now(), satellite_id=satellite_id)

    def propagate_offset(
        self,
        seconds: float,
        *,
        satellite_id: str | None = None,
    ) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(
            utc_now() + datetime.timedelta(seconds=float(seconds)),
            satellite_id=satellite_id,
        )


def _sp3_tabular_provider(
    *,
    samples: tuple[StateVector, ...],
    frame_transformer: FrameTransformService,
) -> TabularStateProvider:
    """Build one SP3 series with its bounded interpolation declaration.

    A one-record fragment is still importable for provenance and an exact
    sample lookup, but it cannot interpolate.  For two or more records, keep
    the method explicit instead of falling back to TabularStateProvider's
    compatibility default of piecewise linear interpolation.
    """

    if len(samples) < 2:
        return TabularStateProvider(
            source_format="SP3",
            samples=samples,
            frame_transformer=frame_transformer,
        )
    degree = min(SP3_MAX_INTERPOLATION_DEGREE, len(samples) - 1)
    return TabularStateProvider(
        source_format="SP3",
        samples=samples,
        declared_interpolation=SP3_INTERPOLATION_METHOD,
        declared_interpolation_degree=degree,
        frame_transformer=frame_transformer,
    )


def parse_sp3_metadata(source: str | Iterable[str]) -> Sp3Metadata:
    """Parse SP3 header metadata without reading its ephemeris samples.

    The returned epoch has no ``tzinfo`` because SP3 declares its scale in a
    separate ``%c`` header line.  The caller can therefore distinguish GPS,
    UTC and future/vendor scales instead of accidentally treating all epochs
    as UTC.
    """

    lines = _source_lines(source)
    header = _first_content_line(lines)
    if header is None or not header.startswith("#") or header.startswith("##"):
        raise EphemerisFormatError("El fichero SP3 debe empezar con la cabecera '#'")
    if len(header) < 51:
        raise EphemerisFormatError("La cabecera SP3 está incompleta")

    version = header[1].lower()
    record_type = header[2].upper()
    if not version.isalnum():
        raise EphemerisFormatError("La versión SP3 no es válida")
    if record_type not in {"P", "V"}:
        raise EphemerisFormatError("El tipo de registro SP3 debe ser P o V")

    epoch = _parse_epoch(header[3:31])
    number_of_epochs = _parse_optional_int(header[32:39], field_name="número de épocas SP3")
    data_used = _optional_text(header[40:45])
    frame_label = _optional_text(header[46:51])
    if frame_label is None:
        raise EphemerisFormatError("La cabecera SP3 no declara el sistema de coordenadas")
    time_scale_label = _find_time_scale_label(lines)

    return Sp3Metadata(
        version=version,
        record_type=record_type,
        epoch=epoch,
        number_of_epochs=number_of_epochs,
        data_used=data_used,
        reference_frame=parse_reference_frame(frame_label),
        time_scale=TimeScale.from_label(time_scale_label),
        time_scale_label=time_scale_label.strip().upper(),
        orbit_type=_optional_text(header[52:55]),
        agency=_optional_text(header[56:60]),
    )


def parse_sp3_state_provider(
    source: str | Iterable[str],
    *,
    frame_transformer: FrameTransformService | None = None,
) -> Sp3StateProvider:
    """Convenience entry point matching the OEM state-provider reader."""

    return Sp3StateProvider.from_text(source, frame_transformer=frame_transformer)


def _source_lines(source: str | Iterable[str]) -> tuple[str, ...]:
    if isinstance(source, str):
        lines = source.lstrip("\ufeff").splitlines()
    else:
        try:
            lines = [str(line).rstrip("\r\n") for line in source]
        except TypeError as exc:
            raise EphemerisFormatError("El contenido SP3 debe ser texto o líneas de texto") from exc
    if not lines:
        raise EphemerisFormatError("El contenido SP3 está vacío")
    return tuple(lines)


def _first_content_line(lines: tuple[str, ...]) -> str | None:
    return next((line for line in lines if line.strip()), None)


def _parse_epoch(value: str) -> datetime.datetime:
    parts = value.split()
    if len(parts) != 6:
        raise EphemerisFormatError("La época de cabecera SP3 no es válida")
    try:
        year, month, day, hour, minute = (int(part) for part in parts[:5])
        seconds = Decimal(parts[5])
        microseconds = int((seconds * Decimal(1_000_000)).to_integral_value(rounding=ROUND_HALF_UP))
        # SP3 calendars carry their own declared time scale. ``source_epoch``
        # attaches the UTC carrier only after the parser has retained that
        # separate scale metadata.
        return datetime.datetime(year, month, day, hour, minute) + datetime.timedelta(  # noqa: DTZ001
            microseconds=microseconds,
        )
    except (InvalidOperation, ValueError, OverflowError) as exc:
        raise EphemerisFormatError("La época de cabecera SP3 no es válida") from exc


def _parse_optional_int(value: str, *, field_name: str) -> int | None:
    text = _optional_text(value)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError as exc:
        raise EphemerisFormatError(f"El {field_name} no es válido") from exc


def _optional_text(value: str) -> str | None:
    text = value.strip()
    return text or None


def _find_time_scale_label(lines: tuple[str, ...]) -> str:
    for line in lines:
        if not line.startswith("%c"):
            continue
        tokens = line[2:].split()
        # SP3 defines this line as ``%c cc TIME_SYSTEM ...``.  Select the
        # declared slot even when the scale is newer than Orbit's enum.
        if len(tokens) >= 2:
            return tokens[1]
    raise EphemerisFormatError("La cabecera SP3 no declara TIME_SYSTEM en una línea %c")


def _sp3_records(
    lines: tuple[str, ...],
) -> tuple[
    dict[tuple[datetime.datetime, str], tuple[float, float, float]],
    dict[tuple[datetime.datetime, str], tuple[float, float, float]],
]:
    """Read P/V record vectors keyed by their native SP3 epoch and satellite."""

    positions: dict[tuple[datetime.datetime, str], tuple[float, float, float]] = {}
    velocities: dict[tuple[datetime.datetime, str], tuple[float, float, float]] = {}
    current_epoch: datetime.datetime | None = None
    for line in lines:
        if line.startswith("*"):
            current_epoch = _parse_epoch(line[1:])
            continue
        if not line.startswith(("P", "V")):
            continue
        if current_epoch is None:
            raise EphemerisFormatError("SP3 contiene un registro de estado antes de su primera época")
        record_type, satellite_id, vector = _sp3_record_vector(line)
        if vector is None:
            continue
        key = (current_epoch, satellite_id)
        target = positions if record_type == "P" else velocities
        if key in target:
            raise EphemerisFormatError(
                f"SP3 contiene un registro {record_type} duplicado para {satellite_id}"
            )
        target[key] = vector
    return positions, velocities


def _sp3_record_vector(line: str) -> tuple[str, str, tuple[float, float, float] | None]:
    record_type = line[0]
    fields = line[1:].split()
    if len(fields) < 4:
        raise EphemerisFormatError("Un registro SP3 P/V debe incluir satélite y tres componentes")
    satellite_id = _satellite_id(fields[0])
    try:
        vector = tuple(float(component) for component in fields[1:4])
    except ValueError as exc:
        raise EphemerisFormatError("Un registro SP3 contiene componentes no numéricos") from exc
    if any(abs(component) >= _SP3_MISSING_COMPONENT for component in vector):
        # The SP3 sentinel means no position/velocity was supplied for that
        # satellite/epoch. It is not a real Earth-centred coordinate.
        return record_type, satellite_id, None
    return record_type, satellite_id, vector  # type: ignore[return-value]


def _sp3_clock_samples(
    lines: tuple[str, ...],
) -> dict[str, dict[datetime.datetime, Sp3ClockSample]]:
    """Read optional position-clock and velocity-clock components.

    Position and velocity records are intentionally scanned independently of
    :func:`_sp3_records`: existing Cartesian parsing continues to accept a
    legal three-component record, while this helper only enriches a product
    when a valid fourth field was actually supplied.
    """

    position_clock: dict[tuple[datetime.datetime, str], float] = {}
    velocity_clock: dict[tuple[datetime.datetime, str], float] = {}
    current_epoch: datetime.datetime | None = None
    for line in lines:
        if line.startswith("*"):
            current_epoch = _parse_epoch(line[1:])
            continue
        if not line.startswith(("P", "V")) or current_epoch is None:
            continue
        fields = line[1:].split()
        if len(fields) < 5:
            continue
        satellite_id = _satellite_id(fields[0])
        try:
            clock_value = float(fields[4])
        except ValueError as exc:
            raise EphemerisFormatError("Un registro SP3 contiene un reloj no numérico") from exc
        if abs(clock_value) >= _SP3_MISSING_COMPONENT:
            continue
        target = position_clock if line.startswith("P") else velocity_clock
        key = (current_epoch, satellite_id)
        if key in target:
            raise EphemerisFormatError(f"SP3 contiene un reloj {line[0]} duplicado para {satellite_id}")
        target[key] = clock_value

    grouped: dict[str, dict[datetime.datetime, Sp3ClockSample]] = {}
    for epoch, satellite_id in set(position_clock) | set(velocity_clock):
        # SP3 P clock is microseconds; V clock rate is 10^-4 microseconds/s.
        # Convert both at the ingestion boundary so later products remain SI.
        bias = position_clock.get((epoch, satellite_id))
        rate = velocity_clock.get((epoch, satellite_id))
        grouped.setdefault(satellite_id, {})[epoch] = Sp3ClockSample(
            satellite_id=satellite_id,
            epoch=source_epoch(epoch),
            bias_seconds=(bias * 1e-6) if bias is not None else None,
            rate_seconds_per_second=(rate * 1e-10) if rate is not None else None,
        )
    return grouped


def _satellite_id(value: str) -> str:
    identifier = str(value or "").strip().upper()
    if not identifier:
        raise EphemerisFormatError("El identificador de satélite SP3 es obligatorio")
    return identifier

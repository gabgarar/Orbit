"""SP3 metadata and native tabulated-state readers.

The parser retains the fixed-width header's frame/time provenance and the
state adapter reads P/V samples without applying a display-frame conversion.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterable
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from types import MappingProxyType
from typing import Mapping

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import TimeScale, utc_now

from .metadata import EphemerisFormatError, Sp3Metadata, parse_reference_frame
from .tabular import TabularStateProvider, source_epoch


_SP3_MISSING_COMPONENT = 999_999.0


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
        object.__setattr__(self, "frame_transformer", transformer)

    @classmethod
    def from_text(
        cls,
        source: str | Iterable[str],
        *,
        frame_transformer: FrameTransformService | None = None,
    ) -> "Sp3StateProvider":
        """Read SP3 samples into per-satellite native-state adapters."""

        lines = _source_lines(source)
        metadata = parse_sp3_metadata(lines)
        if metadata.time_scale is TimeScale.UNKNOWN:
            raise EphemerisFormatError(
                f"SP3 declara una escala temporal no soportada: {metadata.time_scale_label}"
            )

        positions, velocities = _sp3_records(lines)
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
            satellite_id: TabularStateProvider(
                source_format="SP3",
                samples=tuple(samples),
                frame_transformer=transformer,
            )
            for satellite_id, samples in samples_by_satellite.items()
        }
        return cls(metadata=metadata, satellites=providers, frame_transformer=transformer)

    @property
    def satellite_ids(self) -> tuple[str, ...]:
        """Return the normalized identifiers represented by this SP3 file."""

        return tuple(self.satellites)

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
        return FrameId.ITRF.value

    @property
    def ephemeris_reference_realization(self) -> str | None:
        assert self.frame_transformer is not None
        return self.frame_transformer.default_terrestrial_realization

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
        return datetime.datetime(year, month, day, hour, minute) + datetime.timedelta(microseconds=microseconds)
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


def _satellite_id(value: str) -> str:
    identifier = str(value or "").strip().upper()
    if not identifier:
        raise EphemerisFormatError("El identificador de satélite SP3 es obligatorio")
    return identifier

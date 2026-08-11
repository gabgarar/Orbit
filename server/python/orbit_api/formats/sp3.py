"""SP3 metadata and native tabulated-state readers.

The parser retains the fixed-width header's frame/time provenance and the
state adapter reads P/V samples without applying a display-frame conversion.
"""

from __future__ import annotations

import datetime
import math
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from types import MappingProxyType

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import TimeScale, utc_now

from .metadata import EphemerisFormatError, Sp3Metadata, parse_reference_frame
from .tabular import TabularStateProvider, source_epoch

_SP3_MISSING_COMPONENT = 999_999.0

# SP3 epochs are printed with up to eight decimal places, whereas Python's
# ``datetime`` stores microseconds.  Comparing two independently-rounded
# calendar records therefore needs a very small tolerance.  Two microseconds
# is deliberately far below an SP3 sampling interval (normally 300 s) while
# allowing the maximum one-microsecond rounding on each side of a delta.
SP3_EPOCH_CADENCE_TOLERANCE_SECONDS = 2e-6
SP3_INTERPOLATION_KNOT_TOLERANCE_METRES = 1e-9
# A degree-nine local polynomial normally has a much smaller Lebesgue
# constant (about 18 for evenly-spaced nodes).  Real CODE MGEX data can have
# an officially-missing P record near a window edge; the same valid product
# reaches about 386.  512 preserves that known, source-declared gap while
# rejecting substantially amplified sparse/clustered windows before they can
# be presented as precise interpolation.
SP3_MAX_LAGRANGE_LEBESGUE_CONSTANT = 512.0
# Relative to the sum of the barycentric terms.  This catches catastrophic
# cancellation independently of the coordinate values and keeps the test
# scale-invariant after normalising the local time nodes.
SP3_MIN_LAGRANGE_BARYCENTRIC_DENOMINATOR_RELATIVE = 1e-5

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
class Sp3ValidationReport:
    """Successful structural and numerical checks for one SP3 source.

    This is deliberately a *passed* report only: imports fail closed by
    raising :class:`EphemerisFormatError` before this object can be attached
    to a provider.  It is retained with the parsed source so API/UI clients
    can explain exactly what was checked without treating a local upload as
    trustworthy merely because it reached the layer registry.
    """

    declared_epoch_count: int
    observed_epoch_count: int
    declared_satellite_count: int
    declared_satellite_ids: tuple[str, ...]
    header_cadence_seconds: float | None
    cadence_seconds: float | None
    cadence_tolerance_seconds: float
    usable_position_records: int
    missing_sentinel_position_records: int
    usable_satellite_count: int
    interpolation_method: str
    interpolation_max_degree: int
    interpolation_checked_satellite_count: int
    interpolation_checked_knot_count: int
    interpolation_stability_window_count: int
    interpolation_max_knot_error_m: float
    interpolation_knot_tolerance_m: float
    interpolation_max_lebesgue_constant: float
    interpolation_lebesgue_threshold: float
    interpolation_min_barycentric_denominator_relative: float | None
    interpolation_barycentric_denominator_relative_threshold: float
    interpolation_exact_only_satellite_count: int
    interpolation_lagrange_satellite_count: int
    interpolation_full_degree_satellite_count: int
    interpolation_reduced_degree_satellite_count: int
    interpolation_min_lagrange_degree: int | None
    interpolation_max_lagrange_degree: int | None

    def payload(self) -> dict[str, object]:
        """Return the stable, JSON-safe import validation contract."""

        return {
            "status": "passed",
            "header": {
                "epoch_count": self.declared_epoch_count,
                "satellite_count": self.declared_satellite_count,
                "satellite_ids_declared": list(self.declared_satellite_ids),
            },
            "epochs": {
                "count": self.observed_epoch_count,
                "cadence_seconds": self.cadence_seconds,
                "header_cadence_seconds": self.header_cadence_seconds,
                "cadence_tolerance_seconds": self.cadence_tolerance_seconds,
            },
            "positions": {
                "usable_records": self.usable_position_records,
                "missing_sentinel_records": self.missing_sentinel_position_records,
                "usable_satellite_count": self.usable_satellite_count,
            },
            "interpolation": {
                "method": self.interpolation_method,
                "max_degree": self.interpolation_max_degree,
                "degree_policy": "min(9, usable_sample_count - 1); one sample is exact-only",
                "checked_satellite_count": self.interpolation_checked_satellite_count,
                "checked_knot_count": self.interpolation_checked_knot_count,
                "stability_window_count": self.interpolation_stability_window_count,
                "max_knot_error_m": self.interpolation_max_knot_error_m,
                "knot_tolerance_m": self.interpolation_knot_tolerance_m,
                "max_lebesgue_constant": self.interpolation_max_lebesgue_constant,
                "lebesgue_threshold": self.interpolation_lebesgue_threshold,
                "min_barycentric_denominator_relative": (
                    self.interpolation_min_barycentric_denominator_relative
                ),
                "barycentric_denominator_relative_threshold": (
                    self.interpolation_barycentric_denominator_relative_threshold
                ),
                "degree_summary": {
                    "exact_only_satellite_count": self.interpolation_exact_only_satellite_count,
                    "lagrange_satellite_count": self.interpolation_lagrange_satellite_count,
                    "full_degree_satellite_count": self.interpolation_full_degree_satellite_count,
                    "reduced_degree_satellite_count": self.interpolation_reduced_degree_satellite_count,
                    "minimum_lagrange_degree": self.interpolation_min_lagrange_degree,
                    "maximum_lagrange_degree": self.interpolation_max_lagrange_degree,
                },
            },
        }


@dataclass(frozen=True, slots=True)
class _Sp3Structure:
    """Raw-source facts checked before usable samples are constructed."""

    declared_satellite_ids: tuple[str, ...]
    epochs: tuple[datetime.datetime, ...]
    header_cadence_seconds: float | None
    cadence_seconds: float | None
    usable_position_records: int
    missing_sentinel_position_records: int


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
    validation: Sp3ValidationReport | None = None

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
        if self.validation is not None and not isinstance(self.validation, Sp3ValidationReport):
            raise EphemerisFormatError("El informe de validacion SP3 no es valido")

    @classmethod
    def from_text(
        cls,
        source: str | Iterable[str],
        *,
        frame_transformer: FrameTransformService | None = None,
        strict_structure: bool = False,
    ) -> Sp3StateProvider:
        """Read SP3 samples into per-satellite native-state adapters.

        ``strict_structure`` is enabled by the upload/persistence boundary.
        It requires the complete operational SP3 header (``+`` and ``##``)
        and performs the fail-closed import validation.  Keeping compact
        in-memory parser fixtures usable without that flag preserves the
        format reader's historic role for partial/provenance fragments; they
        are never accepted by :mod:`precise_products` as uploaded products.
        """

        lines = _source_lines(source)
        metadata = parse_sp3_metadata(lines)
        if metadata.time_scale is TimeScale.UNKNOWN:
            raise EphemerisFormatError(
                f"SP3 declara una escala temporal no soportada: {metadata.time_scale_label}"
            )

        # Validate the physical source structure before turning any P record
        # into a runtime state.  In particular, a missing-state sentinel is
        # a legal declaration of unavailable data, while NaN, a blank vector,
        # a cadence jump or a header/member mismatch is not.
        structure = _validate_sp3_structure(lines, metadata) if strict_structure else None

        positions, velocities = _sp3_records(lines, strict_layout=strict_structure)
        clock_samples = _sp3_clock_samples(lines, strict_layout=strict_structure)
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
        provider = cls(
            metadata=metadata,
            satellites=providers,
            clock_samples=clocks_by_satellite,
            frame_transformer=transformer,
        )
        if structure is None:
            return provider
        return replace(provider, validation=_validate_sp3_interpolation(provider, structure))

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
    strict_structure: bool = False,
) -> Sp3StateProvider:
    """Convenience entry point matching the OEM state-provider reader.

    The precise-product import service passes ``strict_structure=True``;
    standalone callers can still parse a compact fragment for inspection but
    receive no successful import-validation report for it.
    """

    return Sp3StateProvider.from_text(
        source,
        frame_transformer=frame_transformer,
        strict_structure=strict_structure,
    )


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
    """Return the SP3 ``TIME_SYSTEM`` field without mistaking a placeholder.

    A standards-compliant SP3 ``%c`` line is fixed-width and commonly looks
    like ``%c M  cc GPS ...``.  The ``cc`` token is a literal placeholder,
    while ``GPS`` is the time system.  Earlier compact test fixtures used the
    abbreviated ``%c cc GPS ...`` form, so retain that compatible fallback.
    Unknown *declared* scales are intentionally returned for the caller to
    reject explicitly; placeholders themselves are not declarations.
    """

    unknown_candidates: list[str] = []
    for line in lines:
        if not line.startswith("%c"):
            continue
        tokens = line[2:].split()
        if len(tokens) >= 3 and tokens[0].upper() == "M":
            # In a canonical header TIME_SYSTEM occupies columns 10--12
            # (one-based), i.e. the third whitespace token after ``%c``.
            # Prefer the token so a producer that trims one padding space
            # does not shift ``GPS`` into an invalid fixed-width slice.
            candidate = tokens[2]
        elif len(tokens) >= 2:
            # Compatibility for concise fixtures and older producers that
            # omit the leading ``M`` and its placeholder field.
            candidate = tokens[1]
        else:
            continue

        normalized = candidate.strip().upper()
        if not normalized or set(normalized.casefold()) == {"c"}:
            continue
        if TimeScale.from_label(normalized) is not TimeScale.UNKNOWN:
            return normalized
        unknown_candidates.append(normalized)

    if unknown_candidates:
        # Preserve an actual unrecognised declaration so ``from_text`` can
        # report it accurately instead of silently assuming UTC.
        return unknown_candidates[0]
    raise EphemerisFormatError("La cabecera SP3 no declara TIME_SYSTEM en una línea %c")


def _validate_sp3_structure(lines: tuple[str, ...], metadata: Sp3Metadata) -> _Sp3Structure:
    """Fail closed unless the complete SP3 table matches its header.

    SP3's ``+`` records describe the full member list and ``##`` describes
    the nominal interval.  Checking them here catches a truncated upload,
    a concatenated product and a silently-corrupt epoch table before either
    can be persisted or shown as a seemingly precise orbit.
    """

    # SP3-a through SP3-d are the defined public revisions.  Metadata keeps a
    # permissive reader for legacy in-memory fragments, but an uploaded
    # precise product must not silently accept an arbitrary ``#zP`` header.
    if metadata.version not in {"a", "b", "c", "d"}:
        raise EphemerisFormatError("La versión SP3 no es compatible con la importación estricta")

    if metadata.number_of_epochs is None or metadata.number_of_epochs < 1:
        raise EphemerisFormatError("La cabecera SP3 debe declarar un número positivo de épocas")

    declared_satellite_ids = _declared_satellite_ids(lines)
    header_cadence = _header_cadence_seconds(lines)
    epochs: list[datetime.datetime] = []
    position_ids_by_epoch: dict[datetime.datetime, set[str]] = {}
    seen_position_records: set[tuple[datetime.datetime, str]] = set()
    current_epoch: datetime.datetime | None = None
    usable_position_records = 0
    missing_sentinel_position_records = 0

    for line in lines:
        if line.startswith("*"):
            epoch = _parse_epoch(line[1:])
            if epochs:
                delta = (epoch - epochs[-1]).total_seconds()
                if delta <= 0.0:
                    raise EphemerisFormatError("SP3 contiene épocas duplicadas o no crecientes")
                if not math.isclose(
                    delta,
                    header_cadence,
                    rel_tol=0.0,
                    abs_tol=SP3_EPOCH_CADENCE_TOLERANCE_SECONDS,
                ):
                    raise EphemerisFormatError(
                        "SP3 contiene un salto de época: la cadencia no coincide con la cabecera ##"
                    )
            epochs.append(epoch)
            current_epoch = epoch
            continue

        if not line.startswith(("P", "V")):
            continue
        if current_epoch is None:
            raise EphemerisFormatError("SP3 contiene un registro de estado antes de su primera época")

        record_type, satellite_id, vector = _sp3_record_vector(line, strict_layout=True)
        if record_type != "P":
            continue
        key = (current_epoch, satellite_id)
        if key in seen_position_records:
            raise EphemerisFormatError(f"SP3 contiene un registro P duplicado para {satellite_id}")
        seen_position_records.add(key)
        position_ids_by_epoch.setdefault(current_epoch, set()).add(satellite_id)
        if vector is None:
            # ``999999.999999`` and the documented all-zero P record both
            # mean that a declared satellite has no state at this epoch.
            # They remain part of structural validation but never become a
            # Cartesian sample or a Cesium geometry.
            missing_sentinel_position_records += 1
        else:
            usable_position_records += 1

    if not epochs:
        raise EphemerisFormatError("SP3 no contiene registros de época")
    if len(epochs) != metadata.number_of_epochs:
        raise EphemerisFormatError("El número de épocas SP3 no coincide con la cabecera")
    if not math.isclose(
        (epochs[0] - metadata.epoch).total_seconds(),
        0.0,
        rel_tol=0.0,
        abs_tol=SP3_EPOCH_CADENCE_TOLERANCE_SECONDS,
    ):
        raise EphemerisFormatError("La primera época SP3 no coincide con la cabecera")

    expected_ids = set(declared_satellite_ids)
    for epoch in epochs:
        observed_ids = position_ids_by_epoch.get(epoch, set())
        if observed_ids != expected_ids:
            missing = sorted(expected_ids - observed_ids)
            unexpected = sorted(observed_ids - expected_ids)
            details: list[str] = []
            if missing:
                details.append("faltan " + ", ".join(missing[:5]))
            if unexpected:
                details.append("sobran " + ", ".join(unexpected[:5]))
            suffix = f" ({'; '.join(details)})" if details else ""
            raise EphemerisFormatError(
                "Los satélites de una época SP3 no coinciden con la cabecera" + suffix
            )

    cadence = None
    if len(epochs) >= 2:
        cadence = (epochs[1] - epochs[0]).total_seconds()

    return _Sp3Structure(
        declared_satellite_ids=declared_satellite_ids,
        epochs=tuple(epochs),
        header_cadence_seconds=header_cadence,
        cadence_seconds=cadence,
        usable_position_records=usable_position_records,
        missing_sentinel_position_records=missing_sentinel_position_records,
    )


def _declared_satellite_ids(lines: tuple[str, ...]) -> tuple[str, ...]:
    """Read and verify the fixed-width SP3 ``+`` member list."""

    plus_lines = [line for line in lines if line.startswith("+") and not line.startswith("++")]
    if not plus_lines:
        raise EphemerisFormatError("La cabecera SP3 no declara la lista de satélites en líneas +")

    first = plus_lines[0]
    match = re.match(r"^\+\s*(\d+)", first)
    if match is None:
        raise EphemerisFormatError("La primera línea + de SP3 no declara el número de satélites")
    expected_count = int(match.group(1))
    if expected_count < 1:
        raise EphemerisFormatError("La cabecera SP3 debe declarar al menos un satélite")

    identifiers: list[str] = []
    for line in plus_lines:
        # Satellite IDs occupy fixed-width groups of three starting at column
        # 10 (one based).  The first + line's count lives before that column;
        # continuation lines use blanks in the same area.
        payload = line[9:] if len(line) > 9 else ""
        for offset in range(0, len(payload), 3):
            token = payload[offset:offset + 3].strip().upper()
            if not token or set(token) == {"0"}:
                continue
            if not re.fullmatch(r"[A-Z][A-Z0-9]{2}", token):
                raise EphemerisFormatError("La cabecera SP3 contiene un identificador de satélite inválido")
            identifiers.append(_satellite_id(token))

    if len(identifiers) != expected_count:
        raise EphemerisFormatError(
            "El número de satélites SP3 no coincide con la lista de la cabecera"
        )
    if len(set(identifiers)) != len(identifiers):
        raise EphemerisFormatError("La cabecera SP3 declara satélites duplicados")
    return tuple(identifiers)


def _header_cadence_seconds(lines: tuple[str, ...]) -> float:
    """Parse the positive epoch interval from the required SP3 ``##`` line."""

    cadence_lines = [line for line in lines if line.startswith("##")]
    if len(cadence_lines) != 1:
        raise EphemerisFormatError("La cabecera SP3 debe contener una única línea ## de cadencia")
    tokens = cadence_lines[0][2:].split()
    if len(tokens) < 3:
        raise EphemerisFormatError("La línea ## de SP3 está incompleta")
    try:
        cadence = float(Decimal(tokens[2]))
    except (InvalidOperation, ValueError) as exc:
        raise EphemerisFormatError("La cadencia ## de SP3 no es numérica") from exc
    if not math.isfinite(cadence) or cadence <= 0.0:
        raise EphemerisFormatError("La cadencia ## de SP3 debe ser positiva y finita")
    return cadence


def _validate_sp3_interpolation(
    provider: Sp3StateProvider,
    structure: _Sp3Structure,
) -> Sp3ValidationReport:
    """Prove the bounded SP3 Lagrange adapter preserves every source knot.

    An exact source epoch normally takes the provider's fast path, so this
    routine calls the Lagrange evaluator directly.  It checks every usable
    knot to the documented 1e-9 m contract and evaluates every interval
    midpoint to catch non-finite or unstable arithmetic between source
    epochs before a product can be persisted.
    """

    checked_satellite_count = 0
    checked_knot_count = 0
    stability_window_count = 0
    maximum_error = 0.0
    maximum_lebesgue_constant = 0.0
    minimum_barycentric_denominator_relative: float | None = None
    lagrange_degrees: list[int] = []
    exact_only_satellite_count = 0

    for satellite_id, tabular in provider.satellites.items():
        samples = tabular.samples
        if len(samples) < 2:
            # A one-epoch valid fragment can be retained for provenance and
            # exact lookup, but it has no interval on which to interpolate.
            exact_only_satellite_count += 1
            continue
        if tabular.declared_interpolation != SP3_INTERPOLATION_METHOD:
            raise EphemerisFormatError(
                f"SP3 {satellite_id} no está configurado para interpolación LAGRANGE"
            )
        expected_degree = min(SP3_MAX_INTERPOLATION_DEGREE, len(samples) - 1)
        if tabular.declared_interpolation_degree != expected_degree:
            raise EphemerisFormatError(
                f"SP3 {satellite_id} no usa el grado LAGRANGE esperado"
            )
        checked_satellite_count += 1
        lagrange_degrees.append(expected_degree)

        for index, original in enumerate(samples):
            right_index = min(max(index, 1), len(samples) - 1)
            try:
                reconstructed = tabular._lagrange_interpolate(right_index, original.epoch)
            except EphemerisFormatError as exc:
                raise EphemerisFormatError(
                    f"La interpolación LAGRANGE de SP3 es inestable para {satellite_id}"
                ) from exc
            error = max(
                abs(actual - expected)
                for actual, expected in zip(reconstructed.position_m, original.position_m)
            )
            if not math.isfinite(error) or error >= SP3_INTERPOLATION_KNOT_TOLERANCE_METRES:
                raise EphemerisFormatError(
                    f"La interpolación LAGRANGE de SP3 no reproduce los puntos de {satellite_id}"
                )
            maximum_error = max(maximum_error, error)
            checked_knot_count += 1

        # Check every interpolation interval at its midpoint.  Exact-knot
        # validation above proves source reproduction, while these samples
        # exercise the actual barycentric arithmetic between knots and catch
        # a finite-but-numerically-unstable source window before persistence.
        for right_index in range(1, len(samples)):
            left = samples[right_index - 1]
            right = samples[right_index]
            midpoint = left.epoch + ((right.epoch - left.epoch) / 2)
            try:
                selected = tabular._interpolation_window(right_index, method="LAGRANGE")
                lebesgue_constant, denominator_relative = _lagrange_condition_metrics(
                    selected,
                    midpoint,
                )
                interpolated = tabular._lagrange_interpolate(right_index, midpoint)
            except EphemerisFormatError as exc:
                raise EphemerisFormatError(
                    f"La interpolación LAGRANGE de SP3 es inestable para {satellite_id}"
                ) from exc
            if denominator_relative < SP3_MIN_LAGRANGE_BARYCENTRIC_DENOMINATOR_RELATIVE:
                raise EphemerisFormatError(
                    f"La interpolación LAGRANGE de SP3 tiene un denominador baricéntrico inestable para {satellite_id}"
                )
            if lebesgue_constant > SP3_MAX_LAGRANGE_LEBESGUE_CONSTANT:
                raise EphemerisFormatError(
                    f"La interpolación LAGRANGE de SP3 amplifica demasiado los errores para {satellite_id}"
                )
            if not all(math.isfinite(value) for value in interpolated.position_m):
                raise EphemerisFormatError(
                    f"La interpolación LAGRANGE de SP3 produjo una posición no finita para {satellite_id}"
            )
            maximum_lebesgue_constant = max(maximum_lebesgue_constant, lebesgue_constant)
            if minimum_barycentric_denominator_relative is None:
                minimum_barycentric_denominator_relative = denominator_relative
            else:
                minimum_barycentric_denominator_relative = min(
                    minimum_barycentric_denominator_relative,
                    denominator_relative,
                )
            stability_window_count += 1

    full_degree_satellite_count = sum(
        degree == SP3_MAX_INTERPOLATION_DEGREE for degree in lagrange_degrees
    )
    reduced_degree_satellite_count = len(lagrange_degrees) - full_degree_satellite_count

    return Sp3ValidationReport(
        declared_epoch_count=provider.metadata.number_of_epochs or 0,
        observed_epoch_count=len(structure.epochs),
        declared_satellite_count=len(structure.declared_satellite_ids),
        declared_satellite_ids=structure.declared_satellite_ids,
        header_cadence_seconds=structure.header_cadence_seconds,
        cadence_seconds=structure.cadence_seconds,
        cadence_tolerance_seconds=SP3_EPOCH_CADENCE_TOLERANCE_SECONDS,
        usable_position_records=structure.usable_position_records,
        missing_sentinel_position_records=structure.missing_sentinel_position_records,
        usable_satellite_count=len(provider.satellites),
        interpolation_method=SP3_INTERPOLATION_METHOD,
        interpolation_max_degree=SP3_MAX_INTERPOLATION_DEGREE,
        interpolation_checked_satellite_count=checked_satellite_count,
        interpolation_checked_knot_count=checked_knot_count,
        interpolation_stability_window_count=stability_window_count,
        interpolation_max_knot_error_m=maximum_error,
        interpolation_knot_tolerance_m=SP3_INTERPOLATION_KNOT_TOLERANCE_METRES,
        interpolation_max_lebesgue_constant=maximum_lebesgue_constant,
        interpolation_lebesgue_threshold=SP3_MAX_LAGRANGE_LEBESGUE_CONSTANT,
        interpolation_min_barycentric_denominator_relative=(
            minimum_barycentric_denominator_relative
        ),
        interpolation_barycentric_denominator_relative_threshold=(
            SP3_MIN_LAGRANGE_BARYCENTRIC_DENOMINATOR_RELATIVE
        ),
        interpolation_exact_only_satellite_count=exact_only_satellite_count,
        interpolation_lagrange_satellite_count=len(lagrange_degrees),
        interpolation_full_degree_satellite_count=full_degree_satellite_count,
        interpolation_reduced_degree_satellite_count=reduced_degree_satellite_count,
        interpolation_min_lagrange_degree=min(lagrange_degrees, default=None),
        interpolation_max_lagrange_degree=max(lagrange_degrees, default=None),
    )


def _lagrange_condition_metrics(
    samples: tuple[StateVector, ...],
    epoch: datetime.datetime,
) -> tuple[float, float]:
    """Return scale-independent barycentric conditioning at one query time.

    The result is ``(Lebesgue constant, relative denominator magnitude)``.
    The former bounds interpolation-error amplification; the latter exposes
    cancellation in the barycentric denominator.  Normalising time offsets
    avoids making either quantity depend on whether a valid SP3 samples at
    30, 300 or 900 seconds.
    """

    offsets = tuple((sample.epoch - epoch).total_seconds() for sample in samples)
    if len(offsets) < 2 or not all(math.isfinite(offset) for offset in offsets):
        raise EphemerisFormatError("Los nodos LAGRANGE de SP3 no son finitos")
    scale = max(abs(offset) for offset in offsets)
    if not math.isfinite(scale) or scale <= 0.0:
        raise EphemerisFormatError("Los nodos LAGRANGE de SP3 no permiten normalización")
    nodes = tuple(offset / scale for offset in offsets)
    if any(node == 0.0 for node in nodes) or len(set(nodes)) != len(nodes):
        raise EphemerisFormatError("Los nodos LAGRANGE de SP3 no son distintos de la época de consulta")

    weights: list[float] = []
    for index, node in enumerate(nodes):
        product = 1.0
        for other_index, other_node in enumerate(nodes):
            if index != other_index:
                product *= node - other_node
        if product == 0.0 or not math.isfinite(product):
            raise EphemerisFormatError("Los pesos LAGRANGE de SP3 no son finitos")
        weight = 1.0 / product
        if not math.isfinite(weight):
            raise EphemerisFormatError("Los pesos LAGRANGE de SP3 no son finitos")
        weights.append(weight)

    terms = tuple(weight / -node for weight, node in zip(weights, nodes))
    if not all(math.isfinite(term) for term in terms):
        raise EphemerisFormatError("El denominador baricéntrico LAGRANGE de SP3 no es finito")
    absolute_terms = sum(abs(term) for term in terms)
    denominator = sum(terms)
    if (
        not math.isfinite(absolute_terms)
        or absolute_terms <= 0.0
        or not math.isfinite(denominator)
        or denominator == 0.0
    ):
        raise EphemerisFormatError("El denominador baricéntrico LAGRANGE de SP3 no es estable")
    relative_denominator = abs(denominator) / absolute_terms
    basis = tuple(term / denominator for term in terms)
    lebesgue_constant = sum(abs(value) for value in basis)
    if not math.isfinite(relative_denominator) or not math.isfinite(lebesgue_constant):
        raise EphemerisFormatError("La condición LAGRANGE de SP3 no es finita")
    return lebesgue_constant, relative_denominator


def _sp3_records(
    lines: tuple[str, ...],
    *,
    strict_layout: bool = False,
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
        record_type, satellite_id, vector = _sp3_record_vector(line, strict_layout=strict_layout)
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


def _sp3_record_vector(
    line: str,
    *,
    strict_layout: bool = False,
) -> tuple[str, str, tuple[float, float, float] | None]:
    """Read one Cartesian record, optionally enforcing SP3 column layout.

    The standalone format reader still accepts compact whitespace-delimited
    fragments used for inspection and legacy fixtures.  The upload boundary
    uses ``strict_layout=True`` so a blank X/Y/Z field cannot be hidden by
    subsequent values shifting left when a caller applies ``split()``.
    """

    record_type = line[0]
    if strict_layout:
        if len(line) < 46:
            raise EphemerisFormatError(
                "Un registro SP3 P/V no contiene las columnas cartesianas obligatorias"
            )
        satellite_id = _satellite_id(line[1:4])
        component_fields = (line[4:18], line[18:32], line[32:46])
        if any(not field.strip() for field in component_fields):
            raise EphemerisFormatError("Un registro SP3 contiene un componente cartesiano vacío")
    else:
        fields = line[1:].split()
        if len(fields) < 4:
            raise EphemerisFormatError("Un registro SP3 P/V debe incluir satélite y tres componentes")
        satellite_id = _satellite_id(fields[0])
        component_fields = tuple(fields[1:4])
    try:
        vector = tuple(float(component) for component in component_fields)
    except ValueError as exc:
        raise EphemerisFormatError("Un registro SP3 contiene componentes no numéricos") from exc
    if not all(math.isfinite(component) for component in vector):
        raise EphemerisFormatError("Un registro SP3 contiene componentes no finitos")
    if any(abs(component) >= _SP3_MISSING_COMPONENT for component in vector):
        # The SP3 sentinel means no position/velocity was supplied for that
        # satellite/epoch. It is not a real Earth-centred coordinate.
        return record_type, satellite_id, None
    if record_type == "P" and vector == (0.0, 0.0, 0.0):
        # Real multi-GNSS products also use an all-zero *position* record
        # together with a missing clock sentinel for an unavailable satellite
        # at an individual epoch, e.g. ``PC08 0 0 0 999999.999999``.  A point
        # at the Earth's centre is not a satellite state and Cesium cannot
        # project it to Cartographic coordinates.  Do not apply this rule to
        # V records: a zero ECEF velocity can be legitimate for a stationary
        # or geostationary object.
        return record_type, satellite_id, None
    return record_type, satellite_id, vector  # type: ignore[return-value]


def _sp3_clock_samples(
    lines: tuple[str, ...],
    *,
    strict_layout: bool = False,
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
        if strict_layout:
            # Clock is optional for our Cartesian source contract.  When a
            # producer does provide it, read its fixed SP3 field instead of
            # allowing a missing Cartesian component to shift into it.
            if len(line) < 60 or not line[46:60].strip():
                continue
            satellite_id = _satellite_id(line[1:4])
            clock_field = line[46:60]
        else:
            fields = line[1:].split()
            if len(fields) < 5:
                continue
            satellite_id = _satellite_id(fields[0])
            clock_field = fields[4]
        try:
            clock_value = float(clock_field)
        except ValueError as exc:
            raise EphemerisFormatError("Un registro SP3 contiene un reloj no numérico") from exc
        if not math.isfinite(clock_value):
            raise EphemerisFormatError("Un registro SP3 contiene un reloj no finito")
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

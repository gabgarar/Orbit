"""Native-state adapters shared by tabulated ephemeris formats.

This module deliberately performs no frame transformation.  It turns source
samples into the common :class:`orbit_api.frames.StateVector` contract while
retaining the frame, realization and time scale declared by the source file.
"""

from __future__ import annotations

import datetime
from bisect import bisect_left
from dataclasses import dataclass, field
import math

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import TimeScale, from_utc, to_utc, utc_now

from .metadata import EphemerisFormatError


@dataclass(frozen=True, slots=True)
class TabularStateProvider:
    """Sample states already expressed in one native contract.

    ``samples`` and every native state returned by this provider retain the
    source frame and source time scale. ``native_state_at`` follows Orbit's
    standard UTC query convention, while its optional ``time_scale`` argument
    makes native GPS/TAI/TT queries explicit. That avoids silently treating a
    source calendar as UTC. OEM interpolation declarations are honoured:
    ``LINEAR``, ``LAGRANGE`` and ``HERMITE``. The latter two require an
    explicit degree and enough neighbouring records. Covariance matrices are
    deliberately not interpolated here: an OEM covariance belongs to its own
    navigation-solution epoch, not to the Cartesian interpolation polynomial.
    """

    source_format: str
    samples: tuple[StateVector, ...]
    declared_interpolation: str | None = None
    declared_interpolation_degree: int | None = None
    frame_transformer: FrameTransformService | None = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        source_format = str(self.source_format or "").strip().upper()
        if not source_format:
            raise EphemerisFormatError("El formato de la efeméride tabulada es obligatorio")
        if not self.samples:
            raise EphemerisFormatError("La efeméride tabulada no contiene estados")

        ordered = tuple(sorted(self.samples, key=lambda state: state.epoch))
        first = ordered[0]
        for previous, current in zip(ordered, ordered[1:]):
            if previous.epoch == current.epoch:
                raise EphemerisFormatError("La efeméride tabulada contiene épocas duplicadas")
        for state in ordered[1:]:
            if (
                state.time_scale is not first.time_scale
                or state.frame != first.frame
                or state.frame_realization != first.frame_realization
                or state.center != first.center
            ):
                raise EphemerisFormatError(
                    "Un proveedor tabulado no puede mezclar frame, realización, centro o escala temporal"
                )

        object.__setattr__(self, "source_format", source_format)
        object.__setattr__(self, "samples", ordered)
        object.__setattr__(self, "frame_transformer", self.frame_transformer or FrameTransformService())
        if self.declared_interpolation is not None:
            declared = str(self.declared_interpolation).strip().upper() or None
            object.__setattr__(self, "declared_interpolation", declared)
        if self.declared_interpolation_degree is not None:
            try:
                degree = int(self.declared_interpolation_degree)
            except (TypeError, ValueError) as exc:
                raise EphemerisFormatError("El grado de interpolación debe ser un entero") from exc
            if degree < 0:
                raise EphemerisFormatError("El grado de interpolación no puede ser negativo")
            object.__setattr__(self, "declared_interpolation_degree", degree)
        self._validate_interpolation_declaration()

    @property
    def native_frame(self):
        """Return the exact native frame identifier used by all samples."""

        return self.samples[0].frame

    @property
    def native_realization(self) -> str | None:
        """Return the source frame realization, without choosing a default."""

        return self.samples[0].frame_realization

    @property
    def native_time_scale(self) -> TimeScale:
        """Return the source time scale used to tabulate the samples."""

        return self.samples[0].time_scale

    @property
    def dynamics_reference_frame(self) -> str:
        """Compatibility metadata for the common source/provider contract."""

        frame = self.native_frame
        return frame.value if isinstance(frame, FrameId) else frame

    @property
    def dynamics_reference_realization(self) -> str | None:
        return self.native_realization

    @property
    def ephemeris_reference_frame(self) -> str:
        """Return the source frame represented by this tabular ephemeris.

        This compatibility property used to advertise the renderer's usual
        ITRF target.  That is unsafe for an SP3/OEM source declared in IGS20
        (or another realization) when no datum operation has been registered:
        no ITRF state has then been produced.  Consumers that need a rendered
        view must call :meth:`state_at` explicitly and inspect its returned
        :class:`StateVector`.
        """

        return self.native_realization or self.dynamics_reference_frame

    @property
    def ephemeris_reference_realization(self) -> str | None:
        return self.native_realization

    @property
    def coverage_start(self) -> datetime.datetime:
        return self.samples[0].epoch

    @property
    def coverage_stop(self) -> datetime.datetime:
        return self.samples[-1].epoch

    def native_state_at(
        self,
        instant: datetime.datetime,
        *,
        time_scale: TimeScale | str = TimeScale.UTC,
    ) -> StateVector:
        """Return the native state at ``instant`` with bounded declared-method sampling.

        The common ``OrbitPropagator`` convention is that ``instant`` is UTC,
        hence the UTC default.  Callers parsing a source-native GPS/TAI/TT
        epoch can pass its scale explicitly.  Output epochs always remain in
        the source scale and no frame conversion is applied.
        """

        source_epoch = self._source_epoch(instant, time_scale=time_scale)
        epochs = tuple(sample.epoch for sample in self.samples)
        index = bisect_left(epochs, source_epoch)
        if index < len(epochs) and epochs[index] == source_epoch:
            return self.samples[index]
        if index == 0 or index == len(epochs):
            raise EphemerisFormatError(
                "La época solicitada queda fuera de la cobertura de la efeméride tabulada"
            )
        return self._interpolate(index, source_epoch)

    def state_at(
        self,
        instant: datetime.datetime,
        *,
        target_frame: FrameId | str = FrameId.ITRF,
        target_realization: str | None = None,
        time_scale: TimeScale | str = TimeScale.UTC,
    ) -> StateVector:
        """Sample natively, then request an explicit target-frame view.

        A terrestrial realization such as ``IGS20`` is handed to
        ``FrameTransformService`` unchanged.  Asking for ITRF therefore fails
        unless the caller has registered the appropriate realization transform;
        this adapter never invents an IGS-to-ITRF equivalence.
        """

        assert self.frame_transformer is not None
        return self.frame_transformer.transform(
            self.native_state_at(instant, time_scale=time_scale),
            target_frame=target_frame,
            target_realization=target_realization,
        )

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Legacy renderer adapter matching the installed propagators."""

        return self.state_at(instant, target_frame=FrameId.ITRF).components()

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now())

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now() + datetime.timedelta(seconds=float(seconds)))

    def _source_epoch(
        self,
        epoch: datetime.datetime,
        *,
        time_scale: TimeScale | str,
    ) -> datetime.datetime:
        if not isinstance(epoch, datetime.datetime) or epoch.tzinfo is None:
            raise EphemerisFormatError("La época consultada debe incluir una zona horaria/escala explícita")
        query_scale = TimeScale.from_label(time_scale)
        if query_scale is TimeScale.UNKNOWN:
            raise EphemerisFormatError("La escala temporal de consulta no es reconocida")
        if query_scale is self.native_time_scale:
            return epoch.astimezone(datetime.UTC)
        try:
            assert self.frame_transformer is not None
            leap_seconds = self.frame_transformer.leap_second_table
            if query_scale is TimeScale.UT1:
                # UT1 is not a civil scale with a fixed offset.  Resolve it
                # through the same bounded provisional-UTC -> EOP -> refined
                # UTC sequence used by FrameTransformService, so imported
                # UT1 ephemerides cannot silently assume DUT1 = 0.
                provisional_utc = to_utc(
                    epoch,
                    query_scale,
                    dut1_seconds=0.0,
                    leap_seconds=leap_seconds,
                )
                query_orientation = self.frame_transformer.earth_orientation_at(provisional_utc)
                utc = to_utc(
                    epoch,
                    query_scale,
                    dut1_seconds=query_orientation.dut1_seconds,
                    leap_seconds=leap_seconds,
                )
            else:
                utc = to_utc(epoch, query_scale, leap_seconds=leap_seconds)

            if self.native_time_scale is TimeScale.UT1:
                native_orientation = self.frame_transformer.earth_orientation_at(utc)
                return from_utc(
                    utc,
                    self.native_time_scale,
                    dut1_seconds=native_orientation.dut1_seconds,
                    leap_seconds=leap_seconds,
                )
            return from_utc(utc, self.native_time_scale, leap_seconds=leap_seconds)
        except ValueError as exc:
            raise EphemerisFormatError(
                f"No se puede convertir {query_scale.value} a {self.native_time_scale.value} para interpolar"
            ) from exc

    def _validate_interpolation_declaration(self) -> None:
        """Reject ambiguous interpolation declarations at the ingestion boundary."""

        method = self._interpolation_method
        degree = self.declared_interpolation_degree
        if self.declared_interpolation is None:
            return
        if method not in {"LINEAR", "LAGRANGE", "HERMITE"}:
            raise EphemerisFormatError(
                f"La interpolación declarada {method} no está soportada por Orbit"
            )
        if degree is None:
            raise EphemerisFormatError(
                "INTERPOLATION_DEGREE es obligatorio cuando se declara INTERPOLATION"
            )
        if method == "LINEAR" and degree != 1:
            raise EphemerisFormatError("INTERPOLATION = LINEAR requiere INTERPOLATION_DEGREE = 1")
        if method in {"LAGRANGE", "HERMITE"} and degree < 1:
            raise EphemerisFormatError(
                f"INTERPOLATION = {method} requiere un grado mayor o igual que 1"
            )
        if method == "HERMITE" and degree % 2 == 0:
            raise EphemerisFormatError(
                "INTERPOLATION = HERMITE requiere un grado impar para datos posición/velocidad"
            )

    @property
    def _interpolation_method(self) -> str:
        return self.declared_interpolation or "LINEAR"

    def _interpolate(self, right_index: int, epoch: datetime.datetime) -> StateVector:
        method = self._interpolation_method
        if method == "LINEAR":
            return self._linearly_interpolate(self.samples[right_index - 1], self.samples[right_index], epoch)
        if method == "LAGRANGE":
            return self._lagrange_interpolate(right_index, epoch)
        if method == "HERMITE":
            return self._hermite_interpolate(right_index, epoch)
        # ``__post_init__`` validates explicit declarations. Keep this as a
        # defensive error if an instance was created around that boundary.
        raise EphemerisFormatError(f"La interpolación declarada {method} no está soportada por Orbit")

    def _lagrange_interpolate(self, right_index: int, epoch: datetime.datetime) -> StateVector:
        selected = self._interpolation_window(right_index, method="LAGRANGE")
        offsets = _offset_seconds(selected, epoch)
        position = _lagrange_vector(offsets, tuple(state.position_m for state in selected))
        velocity = _lagrange_optional_vector(offsets, tuple(state.velocity_m_s for state in selected))
        acceleration = _lagrange_optional_vector(offsets, tuple(state.acceleration_m_s2 for state in selected))
        return self._interpolated_state(
            epoch=epoch,
            position=position,
            velocity=velocity,
            acceleration=acceleration,
            method="LAGRANGE",
            selected=selected,
        )

    def _hermite_interpolate(self, right_index: int, epoch: datetime.datetime) -> StateVector:
        selected = self._interpolation_window(right_index, method="HERMITE")
        if any(state.velocity_m_s is None for state in selected):
            raise EphemerisFormatError(
                "INTERPOLATION = HERMITE requiere velocidad en todos los registros seleccionados"
            )
        offsets = _offset_seconds(selected, epoch)
        components: list[tuple[float, float, float]] = []
        for component in range(3):
            values = tuple(state.position_m[component] for state in selected)
            derivatives: list[tuple[float, ...]] = [
                tuple(state.velocity_m_s[component] for state in selected)  # type: ignore[index]
            ]
            components.append(_hermite_value_and_derivatives(offsets, values, tuple(derivatives)))
        position = tuple(component[0] for component in components)
        velocity = tuple(component[1] for component in components)
        acceleration = tuple(component[2] for component in components)
        return self._interpolated_state(
            epoch=epoch,
            position=position,  # type: ignore[arg-type]
            velocity=velocity,  # type: ignore[arg-type]
            acceleration=acceleration,  # type: ignore[arg-type]
            method="HERMITE",
            selected=selected,
            extra={
                "derivative_constraints": "position_and_velocity",
                "acceleration": "derived_from_hermite_polynomial",
            },
        )

    def _interpolation_window(
        self,
        right_index: int,
        *,
        method: str,
    ) -> tuple[StateVector, ...]:
        degree = self.declared_interpolation_degree
        if degree is None:  # Guarded by declaration validation for OEM sources.
            raise EphemerisFormatError(f"INTERPOLATION = {method} requiere INTERPOLATION_DEGREE")
        count = degree + 1 if method == "LAGRANGE" else (degree + 1) // 2
        if len(self.samples) < count:
            raise EphemerisFormatError(
                f"INTERPOLATION = {method} con grado {degree} requiere al menos {count} registros; "
                f"el segmento contiene {len(self.samples)}"
            )
        start = max(0, min(right_index - (count // 2), len(self.samples) - count))
        return self.samples[start:start + count]

    def _linearly_interpolate(
        self,
        left: StateVector,
        right: StateVector,
        epoch: datetime.datetime,
    ) -> StateVector:
        duration = (right.epoch - left.epoch).total_seconds()
        if duration <= 0.0:  # Guarded in __post_init__, kept for defensive clarity.
            raise EphemerisFormatError("Las épocas tabuladas deben ser estrictamente crecientes")
        fraction = (epoch - left.epoch).total_seconds() / duration
        position = _interpolate_vector(left.position_m, right.position_m, fraction)
        velocity = _interpolate_optional_vector(left.velocity_m_s, right.velocity_m_s, fraction)
        acceleration = _interpolate_optional_vector(left.acceleration_m_s2, right.acceleration_m_s2, fraction)
        return self._interpolated_state(
            epoch=epoch,
            position=position,
            velocity=velocity,
            acceleration=acceleration,
            method="LINEAR",
            selected=(left, right),
            extra={"fraction": fraction},
        )

    def _interpolated_state(
        self,
        *,
        epoch: datetime.datetime,
        position: tuple[float, float, float],
        velocity: tuple[float, float, float] | None,
        acceleration: tuple[float, float, float] | None,
        method: str,
        selected: tuple[StateVector, ...],
        extra: dict[str, object] | None = None,
    ) -> StateVector:
        first = selected[0]
        provenance = dict(first.provenance)
        interpolation: dict[str, object] = {
            "method": method,
            "source_format": self.source_format,
            "declared_method": self.declared_interpolation,
            "declared_degree": self.declared_interpolation_degree,
            "sample_count": len(selected),
            "sample_epochs": [state.epoch.isoformat() for state in selected],
            "covariance": "not_interpolated",
        }
        if extra:
            interpolation.update(extra)
        provenance["tabular_interpolation"] = interpolation
        return StateVector(
            epoch=epoch,
            time_scale=first.time_scale,
            frame=first.frame,
            frame_realization=first.frame_realization,
            center=first.center,
            position_m=position,
            velocity_m_s=velocity,
            acceleration_m_s2=acceleration,
            covariance=None,
            provenance=provenance,
            earth_orientation_source=first.earth_orientation_source,
            earth_orientation_version=first.earth_orientation_version,
            earth_orientation_quality=first.earth_orientation_quality,
            earth_orientation_snapshot_id=first.earth_orientation_snapshot_id,
            transform_path=first.transform_path,
        )


def source_epoch(moment: datetime.datetime) -> datetime.datetime:
    """Attach the UTC carrier used for a non-UTC source calendar epoch.

    Python's ``datetime`` has no GPS/TAI/TT tzinfo implementation.  Orbit uses
    an aware UTC carrier solely to satisfy the native state contract; the
    authoritative meaning remains the separate ``StateVector.time_scale``.
    """

    if not isinstance(moment, datetime.datetime):
        raise EphemerisFormatError("La época de la efeméride debe ser una fecha y hora")
    return moment.replace(tzinfo=datetime.UTC) if moment.tzinfo is None else moment.astimezone(datetime.UTC)


def _interpolate_vector(
    left: tuple[float, float, float],
    right: tuple[float, float, float],
    fraction: float,
) -> tuple[float, float, float]:
    return tuple(a + ((b - a) * fraction) for a, b in zip(left, right))  # type: ignore[return-value]


def _interpolate_optional_vector(
    left: tuple[float, float, float] | None,
    right: tuple[float, float, float] | None,
    fraction: float,
) -> tuple[float, float, float] | None:
    if left is None or right is None:
        return None
    return _interpolate_vector(left, right, fraction)


def _offset_seconds(samples: tuple[StateVector, ...], epoch: datetime.datetime) -> tuple[float, ...]:
    """Return interpolation-node seconds relative to the requested epoch."""

    offsets = tuple((sample.epoch - epoch).total_seconds() for sample in samples)
    if len(set(offsets)) != len(offsets):
        raise EphemerisFormatError("Los nodos de interpolación no pueden compartir época")
    return offsets


def _lagrange_vector(
    nodes: tuple[float, ...],
    vectors: tuple[tuple[float, float, float], ...],
) -> tuple[float, float, float]:
    return tuple(
        _lagrange_value(nodes, tuple(vector[component] for vector in vectors))
        for component in range(3)
    )  # type: ignore[return-value]


def _lagrange_optional_vector(
    nodes: tuple[float, ...],
    vectors: tuple[tuple[float, float, float] | None, ...],
) -> tuple[float, float, float] | None:
    if any(vector is None for vector in vectors):
        return None
    return _lagrange_vector(nodes, tuple(vector for vector in vectors if vector is not None))


def _lagrange_value(nodes: tuple[float, ...], values: tuple[float, ...]) -> float:
    """Evaluate the Lagrange polynomial at zero with barycentric weights."""

    if len(nodes) != len(values) or not nodes:
        raise EphemerisFormatError("Los nodos LAGRANGE y sus valores no coinciden")
    for node, value in zip(nodes, values):
        if node == 0.0:
            return value
    weights: list[float] = []
    for index, node in enumerate(nodes):
        denominator = 1.0
        for other_index, other_node in enumerate(nodes):
            if index != other_index:
                denominator *= node - other_node
        if denominator == 0.0:
            raise EphemerisFormatError("Los nodos LAGRANGE no pueden repetirse")
        weights.append(1.0 / denominator)
    numerator = sum((weight / -node) * value for weight, node, value in zip(weights, nodes, values))
    denominator = sum(weight / -node for weight, node in zip(weights, nodes))
    if denominator == 0.0 or not math.isfinite(denominator):
        raise EphemerisFormatError("La evaluación LAGRANGE no es numéricamente estable")
    result = numerator / denominator
    if not math.isfinite(result):
        raise EphemerisFormatError("La evaluación LAGRANGE produjo un valor no finito")
    return result


def _hermite_value_and_derivatives(
    nodes: tuple[float, ...],
    values: tuple[float, ...],
    derivatives: tuple[tuple[float, ...], ...],
) -> tuple[float, float, float]:
    """Evaluate a confluent Hermite polynomial and its first two derivatives.

    ``derivatives`` contains the first, optionally second, derivative at every
    node.  The algorithm is Newton divided differences with repeated nodes;
    it works for irregular OEM sample spacing and does not turn a Hermite
    declaration into a piecewise linear approximation.
    """

    if not nodes or len(nodes) != len(values):
        raise EphemerisFormatError("Los nodos HERMITE y sus valores no coinciden")
    if not derivatives or any(len(order) != len(nodes) for order in derivatives):
        raise EphemerisFormatError("Los derivados HERMITE no coinciden con sus nodos")
    multiplicity = 1 + len(derivatives)
    flattened_nodes: list[float] = []
    flattened_values: list[float] = []
    derivative_orders: list[tuple[float, ...]] = []
    for node_index, node in enumerate(nodes):
        if not math.isfinite(node):
            raise EphemerisFormatError("Los nodos HERMITE deben ser finitos")
        supplied = tuple(order[node_index] for order in derivatives)
        for _ in range(multiplicity):
            flattened_nodes.append(node)
            flattened_values.append(values[node_index])
            derivative_orders.append(supplied)

    size = len(flattened_nodes)
    table = [[0.0 for _ in range(size)] for _ in range(size)]
    for row, value in enumerate(flattened_values):
        table[row][0] = value
    for order in range(1, size):
        for row in range(order, size):
            if flattened_nodes[row] == flattened_nodes[row - order]:
                node_derivatives = derivative_orders[row]
                if order > len(node_derivatives):
                    raise EphemerisFormatError("Los nodos HERMITE repetidos requieren derivados adicionales")
                table[row][order] = node_derivatives[order - 1] / math.factorial(order)
            else:
                denominator = flattened_nodes[row] - flattened_nodes[row - order]
                table[row][order] = (table[row][order - 1] - table[row - 1][order - 1]) / denominator

    coefficients = tuple(table[index][index] for index in range(size))
    value = coefficients[-1]
    first = 0.0
    second = 0.0
    for index in range(size - 2, -1, -1):
        second = (second * -flattened_nodes[index]) + (2.0 * first)
        first = (first * -flattened_nodes[index]) + value
        value = (value * -flattened_nodes[index]) + coefficients[index]
    if not all(math.isfinite(component) for component in (value, first, second)):
        raise EphemerisFormatError("La evaluación HERMITE produjo un valor no finito")
    return value, first, second

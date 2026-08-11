"""IERS-aware frame transformations shared by every state source.

The service deliberately separates native state production from coordinates
requested by a consumer.  TEME uses its legacy GMST/PEF path; GCRF/EME2000 use
the modern GCRS/CIRS/TIRS/ITRF route.  A terrestrial SP3/OEM state never goes
through GMST merely because a renderer happens to request ITRF.
"""

from __future__ import annotations

import datetime
import math
from collections.abc import Callable, Mapping
from dataclasses import replace

from orbit_api.timekeeping import (
    EarthOrientation,
    EarthOrientationCoverageError,
    EarthOrientationProvider,
    LeapSecondTable,
    TimeScale,
    VisualApproximationEarthOrientationProvider,
    default_leap_second_table,
    gmst_rad,
    julian_date,
    tai_minus_utc,
    to_utc,
    utc_to_tt,
    utc_to_ut1,
)

from .model import FrameId, Matrix6, StateVector, Vector3, _normalise_frame

try:  # pyerfa exposes the IAU SOFA algorithms under the ``erfa`` module.
    import erfa as _erfa
except ImportError:  # pragma: no cover - exercised in dependency-minimal dev shells
    _erfa = None


Matrix3 = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
_IDENTITY: Matrix3 = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
_DERIVATIVE_SECONDS = 0.5
_ROTATION_ORTHONORMAL_TOLERANCE = 5.0e-12
_ROTATION_DETERMINANT_TOLERANCE = 5.0e-12
_ROTATION_NORM_RELATIVE_TOLERANCE = 1.0e-12
_ROTATION_NORM_ABSOLUTE_TOLERANCE_METRES = 1.0e-6
_PRECISE_GNSS_LEAP_SNAPSHOT_ERROR = (
    "ECI preciso requiere una tabla de segundos intercalares local, versionada, "
    "con SHA-256 y fecha de caducidad vigente."
)


class FrameTransformationError(ValueError):
    """Raised when Orbit cannot transform a state without inventing metadata."""


def _matvec(matrix: Matrix3, vector: Vector3) -> Vector3:
    return tuple(
        sum(matrix[row][column] * vector[column] for column in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def _matmul(left: Matrix3, right: Matrix3) -> Matrix3:
    return tuple(
        tuple(sum(left[row][index] * right[index][column] for index in range(3)) for column in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def _transpose(matrix: Matrix3) -> Matrix3:
    return tuple(tuple(matrix[column][row] for column in range(3)) for row in range(3))  # type: ignore[return-value]


def _subtract(left: Matrix3, right: Matrix3, divisor: float) -> Matrix3:
    return tuple(
        tuple((left[row][column] - right[row][column]) / divisor for column in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def _second_derivative(before: Matrix3, current: Matrix3, after: Matrix3, seconds: float) -> Matrix3:
    scale = seconds * seconds
    return tuple(
        tuple((after[row][column] - (2.0 * current[row][column]) + before[row][column]) / scale for column in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def _add(*vectors: Vector3) -> Vector3:
    return tuple(sum(vector[index] for vector in vectors) for index in range(3))  # type: ignore[return-value]


def _scale(vector: Vector3, scalar: float) -> Vector3:
    return tuple(component * scalar for component in vector)  # type: ignore[return-value]


def _r3_minus(angle: float) -> Matrix3:
    cosine, sine = math.cos(angle), math.sin(angle)
    return ((cosine, sine, 0.0), (-sine, cosine, 0.0), (0.0, 0.0, 1.0))


def _r1(angle: float) -> Matrix3:
    cosine, sine = math.cos(angle), math.sin(angle)
    return ((1.0, 0.0, 0.0), (0.0, cosine, sine), (0.0, -sine, cosine))


def _r2(angle: float) -> Matrix3:
    cosine, sine = math.cos(angle), math.sin(angle)
    return ((cosine, 0.0, -sine), (0.0, 1.0, 0.0), (sine, 0.0, cosine))


def _external_matrix(value: object) -> Matrix3:
    try:
        return tuple(tuple(float(value[row][column]) for column in range(3)) for row in range(3))  # type: ignore[index,return-value]
    except (TypeError, ValueError, IndexError) as exc:
        raise FrameTransformationError("La biblioteca ERFA devolvió una matriz de transformación inválida") from exc


def _validate_rotation_matrix(matrix: Matrix3) -> None:
    """Fail closed when an Earth-orientation matrix is not a proper rotation.

    A frame change between the built-in Earth-centred frames must preserve a
    Euclidean position norm.  Testing ``RᵀR = I`` and ``det(R) = +1`` here is
    a compact boundary check for broken ERFA input, a future implementation
    mistake, or an accidental reflection.  Datum/Helmert callbacks are not
    checked here because they deliberately take a separate registered path.
    """

    try:
        values = tuple(tuple(float(matrix[row][column]) for column in range(3)) for row in range(3))
    except (TypeError, ValueError, IndexError) as exc:
        raise FrameTransformationError("La matriz de rotación terrestre no tiene dimensiones 3×3 válidas") from exc
    if not all(math.isfinite(value) for row in values for value in row):
        raise FrameTransformationError("La matriz de rotación terrestre contiene valores no finitos")
    transposed = _transpose(values)  # type: ignore[arg-type]
    gram = _matmul(transposed, values)  # type: ignore[arg-type]
    maximum_error = max(
        abs(gram[row][column] - (1.0 if row == column else 0.0))
        for row in range(3)
        for column in range(3)
    )
    if maximum_error > _ROTATION_ORTHONORMAL_TOLERANCE:
        raise FrameTransformationError(
            "La matriz de rotación terrestre no es ortonormal (RᵀR ≠ I)"
        )
    determinant = (
        values[0][0] * ((values[1][1] * values[2][2]) - (values[1][2] * values[2][1]))
        - values[0][1] * ((values[1][0] * values[2][2]) - (values[1][2] * values[2][0]))
        + values[0][2] * ((values[1][0] * values[2][1]) - (values[1][1] * values[2][0]))
    )
    if not math.isfinite(determinant) or abs(determinant - 1.0) > _ROTATION_DETERMINANT_TOLERANCE:
        raise FrameTransformationError(
            "La matriz de rotación terrestre no es una rotación propia (det(R) ≠ +1)"
        )


def _validate_rotation_preserves_position_norm(source: Vector3, transformed: Vector3) -> None:
    """Verify the position invariant of a pure ITRF/celestial rotation."""

    source_norm = math.hypot(*source)
    transformed_norm = math.hypot(*transformed)
    if not math.isfinite(source_norm) or not math.isfinite(transformed_norm):
        raise FrameTransformationError("La comprobación de norma ITRF/ECI no produjo valores finitos")
    if not math.isclose(
        source_norm,
        transformed_norm,
        rel_tol=_ROTATION_NORM_RELATIVE_TOLERANCE,
        abs_tol=_ROTATION_NORM_ABSOLUTE_TOLERANCE_METRES,
    ):
        raise FrameTransformationError(
            "La conversión terrestre/celeste no conserva la norma de la posición (|r|)"
        )


def _julian_parts(
    moment: datetime.datetime,
    orientation: EarthOrientation,
    *,
    leap_second_table: LeapSecondTable | None = None,
) -> tuple[float, float, float, float, float, float]:
    """Return TT and UT1 two-part JDs, using an optional pinned UTC/TAI table.

    Omitting ``leap_second_table`` intentionally preserves the legacy dynamic
    default-table behaviour for direct callers of this module helper. Instance
    methods on :class:`FrameTransformService` always supply their own resolved
    table, if one was configured.
    """

    utc = moment.astimezone(datetime.UTC)
    seconds = utc.second + (utc.microsecond / 1_000_000.0)
    if _erfa is not None:
        utc1, utc2 = _erfa.dtf2d("UTC", utc.year, utc.month, utc.day, utc.hour, utc.minute, seconds)
        # Use Orbit's pinned leap-second table for TT rather than ERFA's
        # bundled UTC->TAI conversion table.  ERFA still supplies the SOFA
        # rotation model; a deployment can update leap seconds locally without
        # any transform performing network I/O or silently using an older
        # package table. Python cannot represent 23:59:60 itself, which is
        # already excluded by Orbit's datetime API.
        ut1 = utc_to_ut1(utc, dut1_seconds=orientation.dut1_seconds)
        tt = utc_to_tt(utc, leap_seconds=leap_second_table)
        ut11, ut12 = _erfa.dtf2d("UT1", ut1.year, ut1.month, ut1.day, ut1.hour, ut1.minute,
                                 ut1.second + (ut1.microsecond / 1_000_000.0))
        tt1, tt2 = _erfa.dtf2d("TT", tt.year, tt.month, tt.day, tt.hour, tt.minute,
                               tt.second + (tt.microsecond / 1_000_000.0))
        return float(tt1), float(tt2), float(ut11), float(ut12), float(utc1), float(utc2)
    utc_jd = julian_date(utc)
    tt_jd = utc_jd + ((tai_minus_utc(utc, leap_seconds=leap_second_table) + 32.184) / 86_400.0)
    ut1_jd = utc_jd + (orientation.dut1_seconds / 86_400.0)
    return 2_451_545.0, tt_jd - 2_451_545.0, 2_451_545.0, ut1_jd - 2_451_545.0, 2_451_545.0, utc_jd - 2_451_545.0


def _fallback_polar_motion(orientation: EarthOrientation) -> Matrix3:
    """Small-angle-compatible PEF/TIRS -> ITRF fallback when ERFA is absent."""

    return _matmul(_r2(orientation.xp_radians), _r1(orientation.yp_radians))


class FrameTransformService:
    """Transform explicit native states without silently relabelling frames.

    ``strict_eop`` rejects visual approximation/extrapolation, which is the
    appropriate policy for analysis/export workflows. The default remains
    useful to the interactive renderer but marks every such state as
    ``approximate`` in its provenance.
    """

    def __init__(
        self,
        eop_provider: EarthOrientationProvider | None = None,
        *,
        default_terrestrial_realization: str | None = None,
        strict_eop: bool = False,
        leap_second_table: LeapSecondTable | None = None,
    ) -> None:
        self._eop_provider = eop_provider or VisualApproximationEarthOrientationProvider()
        # A rotation model/EOP table alone does not prove a specific terrestrial
        # realization.  Keep it unspecified by default; deployments that pin
        # one (or source files that declare it) can opt in explicitly.
        self.default_terrestrial_realization = (
            str(default_terrestrial_realization).strip().upper()
            if default_terrestrial_realization is not None
            else None
        ) or None
        self.strict_eop = bool(strict_eop)
        if leap_second_table is not None and not isinstance(leap_second_table, LeapSecondTable):
            raise TypeError("leap_second_table debe ser una LeapSecondTable o None")
        # ``None`` is deliberate compatibility mode: resolve the process-wide
        # legacy table at each use. A concrete immutable table pins this
        # transformer's UTC/TAI/TT contract independently of other services.
        self._leap_second_table = leap_second_table
        self._terrestrial_transforms: dict[tuple[str, str], Callable[[StateVector], StateVector]] = {}

    @property
    def leap_second_table(self) -> LeapSecondTable:
        """Return this service's pinned table or the live legacy default table."""

        return self._leap_second_table if self._leap_second_table is not None else default_leap_second_table()

    @property
    def has_iau2006_2000a(self) -> bool:
        """Whether this service can perform the full ERFA/SOFA ECI route.

        The dependency-free GMST branch remains useful for explicitly marked
        visual rendering, but must never be presented as an IAU 2006/2000A
        terrestrial-to-inertial reduction for a precise GNSS product.
        """

        return _erfa is not None

    def require_iau2006_2000a(self) -> None:
        """Raise a deterministic error when a precise ITRF→ECI route is absent."""

        if not self.has_iau2006_2000a:
            raise FrameTransformationError(
                "La conversión ITRF→ECI requiere pyerfa/SOFA con IAU 2006/2000A; "
                "el modelo de respaldo visual no es suficiente"
            )

    def require_precise_gnss_leap_second_snapshot(self, moment: datetime.datetime) -> None:
        """Require externally auditable UTC/TAI data for precise GNSS ECI.

        The bundled historical table is intentionally adequate for ordinary
        terrestrial display and deterministic legacy conversions, but it has
        no publisher expiry or file identity.  A precise ITRF→ECI result must
        not present that open-ended default as proof that GPS/TAI→UTC is still
        current.  The deployment factory can provide this contract through
        ``ORBIT_LEAP_SECONDS_PATH``, ``_SHA256`` and ``_VERSION``.
        """

        leap_seconds = self.leap_second_table
        if (
            leap_seconds.version is None
            or leap_seconds.sha256 is None
            or leap_seconds.expires_at is None
        ):
            raise FrameTransformationError(_PRECISE_GNSS_LEAP_SNAPSHOT_ERROR)
        try:
            leap_seconds.require_coverage(moment, require_unexpired=True)
        except ValueError as exc:
            raise FrameTransformationError(
                f"{_PRECISE_GNSS_LEAP_SNAPSHOT_ERROR} {exc}"
            ) from exc

    def with_earth_orientation_provider(
        self,
        provider: EarthOrientationProvider,
        *,
        strict_eop: bool | None = None,
    ) -> "FrameTransformService":
        """Return an isolated transform service using ``provider``.

        A precise GNSS product may carry the ERP snapshot that belongs to its
        SP3.  That snapshot must not replace the process-wide IERS provider:
        two imported products can legitimately have different operational
        revisions and coverage.  The clone preserves the selected terrestrial
        realization and every explicitly registered datum operation, while
        keeping EOP provenance local to the product that supplied it.
        """

        if not hasattr(provider, "at") or not callable(provider.at):
            raise TypeError("provider debe implementar EarthOrientationProvider.at")
        clone = FrameTransformService(
            provider,
            default_terrestrial_realization=self.default_terrestrial_realization,
            strict_eop=self.strict_eop if strict_eop is None else bool(strict_eop),
            leap_second_table=self._leap_second_table,
        )
        clone._terrestrial_transforms = dict(self._terrestrial_transforms)
        return clone

    def register_terrestrial_realization_transform(
        self,
        source_realization: str,
        target_realization: str,
        transform: Callable[[StateVector], StateVector],
        *,
        replace_existing: bool = False,
    ) -> None:
        """Register an explicit Helmert/deformation adapter for future SP3 data.

        Replacing an existing datum operation is intentionally opt-in.  A
        silent replacement could change the scientific provenance of every
        subsequently transformed state.
        """

        source = str(source_realization or "").strip().upper()
        target = str(target_realization or "").strip().upper()
        if not source or not target:
            raise ValueError("Las realizaciones terrestre origen y destino son obligatorias")
        if (source, target) in self._terrestrial_transforms and not replace_existing:
            raise ValueError(
                f"Ya existe una transformacion terrestre registrada: {source} -> {target}. "
                "Usa replace_existing=True para sustituirla explicitamente"
            )
        self._terrestrial_transforms[(source, target)] = transform

    def has_terrestrial_realization_transform(
        self,
        source_realization: str,
        target_realization: str,
    ) -> bool:
        """Return whether an explicit terrestrial-realization operation exists."""

        source = str(source_realization or "").strip().upper()
        target = str(target_realization or "").strip().upper()
        return bool(source and target and (source, target) in self._terrestrial_transforms)

    def earth_orientation_at(self, moment: datetime.datetime) -> EarthOrientation:
        """Expose the versioned EOP used by a UTC state/caching operation."""

        orientation = self._eop_provider.at(moment)
        self._validate_eop(orientation)
        return orientation

    def cache_token_at(self, moment: datetime.datetime) -> tuple[object, ...]:
        """Return all pinned time-data identities used by a transformation.

        An unchanged C04 version is not enough to reuse an ephemeris if either
        its snapshot bytes or the local UTC/TAI table changed.
        """

        leap_seconds = self.leap_second_table
        utc = to_utc(moment, TimeScale.UTC, leap_seconds=leap_seconds)
        self._validate_strict_leap_second_coverage(utc)
        orientation = self.earth_orientation_at(utc)
        return (
            "eop",
            *orientation.identity_token,
            "leap_seconds",
            *leap_seconds.identity_token,
        )

    def transform(
        self,
        state: StateVector,
        *,
        target_frame: FrameId | str,
        target_realization: str | None = None,
        earth_orientation: EarthOrientation | None = None,
    ) -> StateVector:
        """Return ``state`` in a declared target frame.

        The epoch's original scale is preserved in the returned state. UTC is
        derived only internally for IERS/ERFA evaluation, so importing GPS or
        TAI ephemerides does not rewrite their source metadata.
        """

        target, implied_realization = _normalise_frame(target_frame)
        target_realization = str(target_realization or implied_realization or "").strip().upper() or None
        if target is FrameId.ITRF:
            target_realization = target_realization or self.default_terrestrial_realization
        if self._same_frame(state, target, target_realization):
            return state
        if state.center != "EARTH":
            raise FrameTransformationError("Solo se admiten transformaciones de marcos geocéntricos Earth por ahora")
        self._require_precise_gnss_eci_contract(
            state,
            target,
            explicit_earth_orientation=earth_orientation,
        )

        source_realization = self._terrestrial_realization(state.frame, state.frame_realization)
        destination_realization = self._terrestrial_realization(target, target_realization)
        source_external = self._is_external_terrestrial(state.frame)
        target_external = self._is_external_terrestrial(target)
        if source_external or target_external:
            if self._is_terrestrial(state.frame) and self._is_terrestrial(target):
                delegated = self._maybe_transform_terrestrial_realization(
                    state,
                    source_realization,
                    destination_realization,
                )
                if delegated is not None:
                    self._validate_delegated_terrestrial_state(delegated, target, target_realization)
                    return delegated
            raise FrameTransformationError(
                "An external terrestrial frame requires a registered realization transformation before changing frame"
            )

        # A registered ITRF-realization transform is a terrestrial datum
        # operation, not an Earth-orientation rotation.  It must therefore be
        # usable in strict workflows even when no EOP sample is available.
        if state.frame is FrameId.ITRF and target is FrameId.ITRF:
            if (
                source_realization == "LEGACY-UNSPECIFIED"
                and destination_realization not in {None, "LEGACY-UNSPECIFIED"}
            ):
                raise FrameTransformationError(
                    "No se puede relabelar un estado ITRF sin realizacion como "
                    f"{destination_realization}; declara la realizacion de origen "
                    "o registra una operacion de datum publicada"
                )
            delegated = self._maybe_transform_terrestrial_realization(
                state,
                source_realization,
                destination_realization,
            )
            if delegated is not None:
                self._validate_delegated_terrestrial_state(delegated, target, target_realization)
                return delegated

        utc, orientation = self._utc_and_orientation(state, earth_orientation)
        if self.strict_eop and _erfa is None:
            # A final EOP table is only one half of a strict celestial-to-
            # terrestrial reduction.  Do not silently downgrade the IAU
            # 2006/2000A/SOFA model to the visual GMST fallback just because
            # this optional runtime dependency was not installed.
            raise FrameTransformationError(
                "La transformación estricta requiere pyerfa/SOFA; el modelo de respaldo visual no es suficiente"
            )
        if self._is_terrestrial(state.frame) and self._is_terrestrial(target):
            delegated = self._maybe_transform_terrestrial_realization(state, source_realization, destination_realization)
            if delegated is not None:
                self._validate_delegated_terrestrial_state(delegated, target, target_realization)
                return delegated

        matrix = self._matrix_between(state.frame, target, utc, orientation)
        _validate_rotation_matrix(matrix)
        derivative: Matrix3 | None = None
        second_derivative: Matrix3 | None = None
        if state.velocity_m_s is not None or state.acceleration_m_s2 is not None or state.covariance is not None:
            derivative, second_derivative = self._matrix_derivatives(
                state.frame,
                target,
                utc,
                orientation,
                explicit_orientation=earth_orientation is not None,
            )
        position = _matvec(matrix, state.position_m)
        _validate_rotation_preserves_position_norm(state.position_m, position)
        velocity = None
        if state.velocity_m_s is not None:
            assert derivative is not None
            velocity = _add(_matvec(matrix, state.velocity_m_s), _matvec(derivative, state.position_m))
        acceleration = None
        if state.acceleration_m_s2 is not None:
            assert derivative is not None and second_derivative is not None
            acceleration = _add(
                _matvec(matrix, state.acceleration_m_s2),
                _scale(_matvec(derivative, state.velocity_m_s or (0.0, 0.0, 0.0)), 2.0),
                _matvec(second_derivative, state.position_m),
            )
        covariance = self._transform_covariance(state.covariance, matrix, derivative)
        path = self._transform_path(state.frame, target)
        provenance = dict(state.provenance)
        eop_provenance = {
            "source": orientation.source,
            "version": orientation.version,
            "quality": orientation.quality,
        }
        if orientation.snapshot_id is not None:
            eop_provenance["snapshot_id"] = orientation.snapshot_id
        leap_seconds = self.leap_second_table
        provenance["frame_transform"] = {
            "source_frame": self._frame_name(state.frame, state.frame_realization),
            "target_frame": self._frame_name(target, target_realization),
            "path": list(path),
            "model": "IAU 2006/2000A + IERS EOP" if _erfa is not None else "GMST + polar-motion fallback",
            "earth_orientation": eop_provenance,
            "leap_seconds": {
                "source": leap_seconds.source,
                "version": leap_seconds.version,
                "sha256": leap_seconds.sha256,
            },
        }
        return StateVector(
            epoch=state.epoch,
            time_scale=state.time_scale,
            frame=target,
            frame_realization=target_realization,
            center=state.center,
            position_m=position,
            velocity_m_s=velocity,
            acceleration_m_s2=acceleration,
            covariance=covariance,
            provenance=provenance,
            earth_orientation_source=orientation.source,
            earth_orientation_version=orientation.version,
            earth_orientation_quality=orientation.quality,
            earth_orientation_snapshot_id=orientation.snapshot_id,
            transform_path=path,
        )

    def _same_frame(self, state: StateVector, target: FrameId | str, target_realization: str | None) -> bool:
        if state.frame != target:
            return False
        if target is not FrameId.ITRF:
            return state.frame_realization == target_realization
        return not target_realization or state.frame_realization == target_realization

    def _require_precise_gnss_eci_contract(
        self,
        state: StateVector,
        target: FrameId | str,
        *,
        explicit_earth_orientation: EarthOrientation | None,
    ) -> None:
        """Prevent a product-bound SP3 state from bypassing its ERP guard.

        ``PreciseProduct.eci_state_at`` is the public high-level API, but a
        caller can also retain its tabular provider and request EME2000
        directly.  The per-sample contract makes that lower-level path obey
        the same no-ERP/no-IAU policy instead of falling back to the process
        visual EOP provider.  Other formats intentionally carry no such
        marker and retain their existing explicit transformation behaviour.
        """

        if target not in {FrameId.CIRS, FrameId.GCRF, FrameId.ICRF, FrameId.EME2000}:
            return
        if not state.is_terrestrial:
            return
        contract = state.provenance.get("precise_gnss_frame_contract")
        if not isinstance(contract, Mapping):
            return
        if explicit_earth_orientation is not None:
            # Product ERP is part of the source contract.  Accepting an
            # arbitrary caller-supplied EOP here would make an apparently
            # product-bound SP3 ECI state depend on a different DUT1/polar
            # motion solution.  The high-level product method intentionally
            # offers no override; preserve that rule on the public lower-level
            # transform path as well.
            raise FrameTransformationError(
                "Los estados SP3 precisos deben usar el ERP importado; no se admite un EarthOrientation explícito para convertir a ECI."
            )
        reason = str(contract.get("eci_reason") or "La conversión a ECI no está disponible para este producto SP3.")
        if not bool(contract.get("erp_present")):
            raise FrameTransformationError("Debe proporcionar un fichero ERP para convertir a ECI.")
        if not bool(contract.get("eci_route_available")):
            raise FrameTransformationError(reason)
        if not bool(contract.get("eci_iau2006_2000a_available")):
            raise FrameTransformationError(reason)
        if not bool(contract.get("eci_leap_seconds_available")):
            raise FrameTransformationError(reason)
        if not bool(contract.get("eci_available_within_erp_coverage")):
            raise FrameTransformationError(reason)

        # Do not rely on the later EOP lookup to reject a partial ERP.  The
        # state provider is a public OrbitRuntime route, so make the
        # product-declared ERP window an explicit boundary check here too.  It
        # prevents a lower-level caller from discovering a coverage fault only
        # after the frame calculation has started, and gives the same public
        # error as PreciseProduct.eci_state_at.
        coverage = contract.get("eci_coverage")
        if not isinstance(coverage, Mapping):
            raise FrameTransformationError(
                "El contrato ERP del producto SP3 no declara una cobertura válida para convertir a ECI."
            )
        try:
            raw_start = str(coverage["erp_start"] or "")
            raw_end = str(coverage["erp_end"] or "")
            erp_start = datetime.datetime.fromisoformat(raw_start.replace("Z", "+00:00"))
            erp_end = datetime.datetime.fromisoformat(raw_end.replace("Z", "+00:00"))
            if erp_start.tzinfo is None or erp_end.tzinfo is None:
                raise ValueError("ERP coverage has no UTC offset")
            erp_start = erp_start.astimezone(datetime.UTC)
            erp_end = erp_end.astimezone(datetime.UTC)

            scale = TimeScale.from_label(state.time_scale)
            if scale is TimeScale.UT1:
                # DUT1 is indexed in UTC.  Use the same bounded provisional
                # UTC -> ERP -> refined UTC sequence as the actual transform.
                provisional_utc = to_utc(
                    state.epoch,
                    scale,
                    dut1_seconds=0.0,
                    leap_seconds=self.leap_second_table,
                )
                orientation = self.earth_orientation_at(provisional_utc)
                requested_utc = to_utc(
                    state.epoch,
                    scale,
                    dut1_seconds=orientation.dut1_seconds,
                    leap_seconds=self.leap_second_table,
                )
            else:
                requested_utc = to_utc(
                    state.epoch,
                    scale,
                    leap_seconds=self.leap_second_table,
                )
        except (KeyError, TypeError, ValueError) as exc:
            raise FrameTransformationError(
                "No se puede resolver la época UTC y la cobertura ERP del producto SP3 para convertir a ECI."
            ) from exc
        if erp_start > erp_end:
            raise FrameTransformationError(
                "El contrato ERP del producto SP3 declara una cobertura temporal inválida para convertir a ECI."
            )
        if not erp_start <= requested_utc <= erp_end:
            raise FrameTransformationError(
                "El ERP importado no cubre la época solicitada para convertir a ECI."
            )

    def _utc_and_orientation(
        self,
        state: StateVector,
        explicit: EarthOrientation | None,
    ) -> tuple[datetime.datetime, EarthOrientation]:
        if explicit is not None:
            self._validate_eop(explicit)
            utc = to_utc(
                state.epoch,
                state.time_scale,
                dut1_seconds=explicit.dut1_seconds,
                leap_seconds=self.leap_second_table,
            )
            self._validate_strict_leap_second_coverage(utc)
            return utc, explicit
        if state.time_scale is TimeScale.UT1:
            provisional = to_utc(
                state.epoch,
                state.time_scale,
                dut1_seconds=0.0,
                leap_seconds=self.leap_second_table,
            )
            first = self.earth_orientation_at(provisional)
            utc = to_utc(
                state.epoch,
                state.time_scale,
                dut1_seconds=first.dut1_seconds,
                leap_seconds=self.leap_second_table,
            )
            self._validate_strict_leap_second_coverage(utc)
            return utc, self.earth_orientation_at(utc)
        utc = to_utc(state.epoch, state.time_scale, leap_seconds=self.leap_second_table)
        self._validate_strict_leap_second_coverage(utc)
        return utc, self.earth_orientation_at(utc)

    def _validate_eop(self, orientation: EarthOrientation) -> None:
        if self.strict_eop and orientation.quality not in {"final", "rapid"}:
            raise FrameTransformationError(
                "La transformación precisa requiere EOP IERS con calidad final o rapid"
            )

    def _validate_strict_leap_second_coverage(self, utc: datetime.datetime) -> None:
        """Enforce local leap-table bounds only for strict deployed services.

        The factory installs a SHA-identified local table for strict mode. A
        direct library caller may deliberately inject a programmatic test table
        without a file identity, so preserve that existing usage rather than
        turning strict EOP into an unrelated global-table requirement.
        """

        if not self.strict_eop:
            return
        leap_seconds = self.leap_second_table
        if leap_seconds.sha256 is not None:
            leap_seconds.require_coverage(utc, require_unexpired=True)

    @staticmethod
    def _frame_name(frame: FrameId | str, realization: str | None) -> str:
        name = frame.value if isinstance(frame, FrameId) else frame
        return realization or name

    @staticmethod
    def _is_terrestrial(frame: FrameId | str) -> bool:
        return frame in {FrameId.ITRF, FrameId.TIRS, FrameId.PEF} or (
            isinstance(frame, str) and frame.startswith(("IG", "WGS", "PZ"))
        )

    @classmethod
    def _is_external_terrestrial(cls, frame: FrameId | str) -> bool:
        """Return whether ``frame`` is a non-ITRF terrestrial source label."""

        # ``FrameId`` deliberately inherits from ``str`` so it serializes
        # naturally at the API boundary.  Check it first: otherwise standard
        # internal frames such as TEME/PEF/ITRF are mistaken for imported
        # labels and every normal celestial-to-terrestrial transformation is
        # incorrectly routed through the datum-adapter guard.
        return not isinstance(frame, FrameId) and isinstance(frame, str) and cls._is_terrestrial(frame)

    def _terrestrial_realization(self, frame: FrameId | str, realization: str | None) -> str | None:
        if frame is FrameId.ITRF:
            return realization or "LEGACY-UNSPECIFIED"
        if not isinstance(frame, FrameId) and isinstance(frame, str) and self._is_terrestrial(frame):
            return realization or frame
        return None

    def _maybe_transform_terrestrial_realization(
        self,
        state: StateVector,
        source: str | None,
        target: str | None,
    ) -> StateVector | None:
        if source == target:
            return None
        if source == "LEGACY-UNSPECIFIED":
            # Existing renderer states predate explicit realization metadata.
            # They may still be rotated into another non-ITRF frame, but this
            # helper must not itself manufacture a datum realization.
            return None
        callback = self._terrestrial_transforms.get((source, target))
        if callback is not None:
            return callback(state)
        raise FrameTransformationError(
            f"No existe una transformación de realización terrestre registrada: {source} → {target}"
        )

    @staticmethod
    def _validate_delegated_terrestrial_state(
        state: StateVector,
        target: FrameId | str,
        target_realization: str | None,
    ) -> None:
        """Ensure a registered realization callback cannot silently mislabel output."""

        if state.frame != target:
            raise FrameTransformationError("La transformación terrestre registrada devolvió un frame distinto del solicitado")
        if target_realization is not None and state.frame_realization != target_realization:
            raise FrameTransformationError(
                "La transformación terrestre registrada devolvió una realización distinta de la solicitada"
            )

    def _matrix_between(
        self,
        source: FrameId | str,
        target: FrameId | str,
        utc: datetime.datetime,
        orientation: EarthOrientation,
    ) -> Matrix3:
        source_to_itrf = self._matrix_to_itrf(source, utc, orientation)
        target_to_itrf = self._matrix_to_itrf(target, utc, orientation)
        return _matmul(_transpose(target_to_itrf), source_to_itrf)

    def _matrix_to_itrf(
        self,
        frame: FrameId | str,
        utc: datetime.datetime,
        orientation: EarthOrientation,
    ) -> Matrix3:
        if frame is FrameId.ITRF:
            return _IDENTITY
        if not isinstance(frame, FrameId) and isinstance(frame, str):
            if self._is_terrestrial(frame):
                return _IDENTITY
            raise FrameTransformationError(f"El marco de origen '{frame}' no tiene ruta de transformación registrada")
        if frame is FrameId.PEF:
            return self._polar_motion_matrix(utc, orientation)
        if frame is FrameId.TIRS:
            return self._polar_motion_matrix(utc, orientation)
        if frame is FrameId.CIRS:
            return _matmul(self._polar_motion_matrix(utc, orientation), self._earth_rotation_matrix(utc, orientation))
        if frame is FrameId.TEME:
            return _matmul(self._polar_motion_matrix(utc, orientation), self._teme_rotation_matrix(utc, orientation))
        if frame in {FrameId.GCRF, FrameId.ICRF, FrameId.EME2000}:
            return self._gcrf_to_itrf_matrix(frame, utc, orientation)
        raise FrameTransformationError(f"No hay transformación ITRF para {frame.value}")

    def _polar_motion_matrix(self, utc: datetime.datetime, orientation: EarthOrientation) -> Matrix3:
        if _erfa is not None:
            tt1, tt2, _ut11, _ut12, _utc1, _utc2 = _julian_parts(
                utc,
                orientation,
                leap_second_table=self.leap_second_table,
            )
            sp = _erfa.sp00(tt1, tt2)
            return _external_matrix(_erfa.pom00(orientation.xp_radians, orientation.yp_radians, sp))
        return _fallback_polar_motion(orientation)

    def _earth_rotation_matrix(self, utc: datetime.datetime, orientation: EarthOrientation) -> Matrix3:
        if _erfa is not None:
            _tt1, _tt2, ut11, ut12, _utc1, _utc2 = _julian_parts(
                utc,
                orientation,
                leap_second_table=self.leap_second_table,
            )
            return _r3_minus(float(_erfa.era00(ut11, ut12)))
        return _r3_minus(gmst_rad(utc, dut1_seconds=orientation.dut1_seconds))

    def _teme_rotation_matrix(self, utc: datetime.datetime, orientation: EarthOrientation) -> Matrix3:
        if _erfa is not None:
            _tt1, _tt2, ut11, ut12, _utc1, _utc2 = _julian_parts(
                utc,
                orientation,
                leap_second_table=self.leap_second_table,
            )
            return _r3_minus(float(_erfa.gmst82(ut11, ut12)))
        return _r3_minus(gmst_rad(utc, dut1_seconds=orientation.dut1_seconds))

    def _gcrf_to_itrf_matrix(
        self,
        frame: FrameId,
        utc: datetime.datetime,
        orientation: EarthOrientation,
    ) -> Matrix3:
        if _erfa is None:
            # The dependency-free branch retains a documented visual path. It
            # is never advertised as a full GCRF/ITRF reduction.
            return _matmul(self._polar_motion_matrix(utc, orientation), self._earth_rotation_matrix(utc, orientation))
        tt1, tt2, ut11, ut12, _utc1, _utc2 = _julian_parts(
            utc,
            orientation,
            leap_second_table=self.leap_second_table,
        )
        cip_x, cip_y, _cio_s = _erfa.xys06a(tt1, tt2)
        celestial_to_terrestrial = _external_matrix(
            _erfa.c2txy(
                tt1,
                tt2,
                ut11,
                ut12,
                float(cip_x) + orientation.dx_radians,
                float(cip_y) + orientation.dy_radians,
                orientation.xp_radians,
                orientation.yp_radians,
            )
        )
        if frame is FrameId.EME2000:
            frame_bias, _precession, _bias_precession = _erfa.bp00(tt1, tt2)
            return _matmul(celestial_to_terrestrial, _transpose(_external_matrix(frame_bias)))
        return celestial_to_terrestrial

    def _matrix_derivatives(
        self,
        source: FrameId | str,
        target: FrameId | str,
        utc: datetime.datetime,
        orientation: EarthOrientation,
        *,
        explicit_orientation: bool,
    ) -> tuple[Matrix3, Matrix3]:
        delta = datetime.timedelta(seconds=_DERIVATIVE_SECONDS)
        before_eop = self._orientation_at_offset(utc - delta, orientation, -_DERIVATIVE_SECONDS, explicit_orientation)
        after_eop = self._orientation_at_offset(utc + delta, orientation, _DERIVATIVE_SECONDS, explicit_orientation)
        before = self._matrix_between(source, target, utc - delta, before_eop)
        current = self._matrix_between(source, target, utc, orientation)
        after = self._matrix_between(source, target, utc + delta, after_eop)
        return _subtract(after, before, 2.0 * _DERIVATIVE_SECONDS), _second_derivative(
            before, current, after, _DERIVATIVE_SECONDS
        )

    def _orientation_at_offset(
        self,
        moment: datetime.datetime,
        current: EarthOrientation,
        seconds: float,
        explicit: bool,
    ) -> EarthOrientation:
        if not explicit:
            try:
                return self.earth_orientation_at(moment)
            except EarthOrientationCoverageError:
                # A strict daily table can be sampled exactly at its edge.
                # Its local derivative still needs a bounded EOP assumption.
                pass
        dut1 = current.dut1_seconds
        if current.lod_seconds is not None:
            # d(UT1-UTC)/dt = -LOD / 86400.
            dut1 -= current.lod_seconds * seconds / 86_400.0
        return replace(current, dut1_seconds=dut1, sampled_at=moment)

    @staticmethod
    def _transform_covariance(
        covariance: Matrix6 | None,
        matrix: Matrix3,
        derivative: Matrix3 | None,
    ) -> Matrix6 | None:
        if covariance is None:
            return None
        derivative = derivative or ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        jacobian = [[0.0 for _ in range(6)] for _ in range(6)]
        for row in range(3):
            for column in range(3):
                jacobian[row][column] = matrix[row][column]
                jacobian[row + 3][column] = derivative[row][column]
                jacobian[row + 3][column + 3] = matrix[row][column]
        intermediate = [
            [sum(jacobian[row][index] * covariance[index][column] for index in range(6)) for column in range(6)]
            for row in range(6)
        ]
        result = tuple(
            tuple(sum(intermediate[row][index] * jacobian[column][index] for index in range(6)) for column in range(6))
            for row in range(6)
        )
        return result  # type: ignore[return-value]

    @staticmethod
    def _transform_path(source: FrameId | str, target: FrameId | str) -> tuple[str, ...]:
        source_name = source.value if isinstance(source, FrameId) else source
        target_name = target.value if isinstance(target, FrameId) else target
        if source is FrameId.TEME and target is FrameId.ITRF:
            return ("TEME", "PEF", "ITRF")
        if source in {FrameId.GCRF, FrameId.ICRF, FrameId.EME2000} and target is FrameId.ITRF:
            return (source_name, "CIRS", "TIRS", "ITRF")
        if source is FrameId.ITRF and target in {FrameId.GCRF, FrameId.ICRF, FrameId.EME2000}:
            return ("ITRF", "TIRS", "CIRS", target_name)
        return (source_name, target_name)

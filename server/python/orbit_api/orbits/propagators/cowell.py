"""Native Cowell propagation for manually authored Earth orbits.

The existing Two-body and first-order J2 engines are analytical and therefore
very fast. They cannot, however, apply a force that changes orbital energy.
This module is the deliberately configurable numerical path selected as
``cowell-rk4``. It always includes central gravity and composes legacy zonals,
drag, a rigorously Earth-fixed configurable geopotential, Sun/Moon third
bodies, cannonball SRP and first-order relativity as independent force terms.
Historical gravity presets remain accepted only as compatibility input and
normalize to their legacy composition.

States remain in the explicit EME2000 compatibility frame in km and km/s
internally. The renderer contract is still ITRF metres/metres/s and is
applied only at the public adapter boundary. The integrator is a fixed-step
RK4 Cowell method; it is intended for interactive design previews, not
precision OD or a replacement for a full atmosphere / SRP toolkit.
"""

from __future__ import annotations

import bisect
import datetime
import math
import threading
from collections.abc import Iterable, Mapping

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.orbits.forces.celestial import (
    MOON_BODY,
    MOON_GRAVITATIONAL_PARAMETER_M3_S2,
    SUN_BODY,
    SUN_GRAVITATIONAL_PARAMETER_M3_S2,
    CelestialEphemeris,
    CelestialEphemerisError,
    cannonball_solar_radiation_pressure_acceleration,
    cylindrical_umbra_eclipse_factor,
    differential_third_body_acceleration,
)
from orbit_api.orbits.forces.context import ForceEvaluationContext, ForceEvaluationError
from orbit_api.orbits.forces.geopotential import (
    GeopotentialConfiguration,
    GravityFieldError,
    GravityFieldModel,
    geopotential_perturbation_acceleration_itrf,
)
from orbit_api.timekeeping import ensure_utc, utc_now

from .classical import (
    EARTH_EQUATORIAL_RADIUS_KM,
    EARTH_MU_KM3_S2,
)

# WGS-84 unnormalised zonal gravity coefficients.  The gravity field's z axis
# is treated as Earth-fixed spin axis, which is also the conventional ECI z
# axis for this first-order perturbation model.
WGS84_J2 = 1.08262668355315e-3
WGS84_J3 = -2.53265648533224e-6
WGS84_J4 = -1.61962159136700e-6
WGS84_FLATTENING = 1.0 / 298.257223563
WGS84_POLAR_RADIUS_KM = EARTH_EQUATORIAL_RADIUS_KM * (1.0 - WGS84_FLATTENING)

_ZONAL_COEFFICIENTS = {
    2: WGS84_J2,
    3: WGS84_J3,
    4: WGS84_J4,
}

# US Standard Atmosphere-style density anchors.  The model linearly chooses a
# base layer and applies rho = rho0 exp(-(h-h0)/H).  It intentionally does not
# claim solar/geomagnetic fidelity; metadata calls it out as first-order.
_EXPONENTIAL_ATMOSPHERE = (
    (0.0, 1.225, 7.249),
    (25.0, 3.899e-2, 6.349),
    (30.0, 1.774e-2, 6.682),
    (40.0, 3.972e-3, 7.554),
    (50.0, 1.057e-3, 8.382),
    (60.0, 3.206e-4, 7.714),
    (70.0, 8.770e-5, 6.549),
    (80.0, 1.905e-5, 5.799),
    (90.0, 3.396e-6, 5.382),
    (100.0, 5.297e-7, 5.877),
    (110.0, 9.661e-8, 7.263),
    (120.0, 2.438e-8, 9.473),
    (130.0, 8.484e-9, 12.636),
    (140.0, 3.845e-9, 16.149),
    (150.0, 2.070e-9, 22.523),
    (180.0, 5.464e-10, 29.740),
    (200.0, 2.789e-10, 37.105),
    (250.0, 7.248e-11, 45.546),
    (300.0, 2.418e-11, 53.628),
    (350.0, 9.518e-12, 53.298),
    (400.0, 3.725e-12, 58.515),
    (450.0, 1.585e-12, 60.828),
    (500.0, 6.967e-13, 63.822),
    (600.0, 1.454e-13, 71.835),
    (700.0, 3.614e-14, 88.667),
    (800.0, 1.170e-14, 124.640),
    (900.0, 5.245e-15, 181.050),
    (1000.0, 3.019e-15, 268.000),
)
_ATMOSPHERE_CEILING_KM = 1_500.0
_STATE = tuple[float, float, float, float, float, float]
_GRAVITY_MODELS = {
    "two-body": ("central",),
    "j2": ("central", "j2"),
    "j2-j3-j4": ("central", "j2", "j3", "j4"),
}
_FORCE_TERM_ORDER = (
    "central",
    "j2",
    "j3",
    "j4",
    "drag",
    "geopotential",
    "third-body-sun",
    "third-body-moon",
    "solar-radiation-pressure",
    "relativity",
)
_FORCE_TERM_ALIASES = {
    "central": "central",
    "central-gravity": "central",
    "two-body": "central",
    "two-body-gravity": "central",
    "j2": "j2",
    "j3": "j3",
    "j4": "j4",
    "drag": "drag",
    "atmospheric-drag": "drag",
    "atmospheric": "drag",
    "geopotential": "geopotential",
    "gravity-field": "geopotential",
    "full-geopotential": "geopotential",
    "third-body-sun": "third-body-sun",
    "sun": "third-body-sun",
    "solar-gravity": "third-body-sun",
    "third-body-moon": "third-body-moon",
    "moon": "third-body-moon",
    "lunar-gravity": "third-body-moon",
    "solar-radiation-pressure": "solar-radiation-pressure",
    "srp": "solar-radiation-pressure",
    "solar-pressure": "solar-radiation-pressure",
    "relativity": "relativity",
    "schwarzschild": "relativity",
}

_SPEED_OF_LIGHT_KM_S = 299_792.458


def _finite(value: object, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} debe ser numÃ©rico") from exc
    if not math.isfinite(number):
        raise ValueError(f"{label} debe ser finito")
    return number


def _normalize_term(value: object) -> str:
    normalized = "-".join(
        part
        for part in str(value or "").strip().lower().replace("_", "-").replace("/", "-").replace("+", "-").split()
        if part
    )
    while "--" in normalized:
        normalized = normalized.replace("--", "-")
    return normalized.strip("-")


def _normalize_force_terms(
    force_terms: Iterable[str] | str,
    *,
    atmospheric_drag: bool = False,
) -> tuple[str, ...]:
    """Return explicit, ordered terms with central gravity always enabled.

    When an explicit composition is supplied it is authoritative, including
    the presence or absence of ``drag``. The ``atmospheric_drag`` boolean is
    only used when translating a legacy gravity-model preset.
    """

    if isinstance(force_terms, str):
        legacy = _GRAVITY_MODELS.get(_normalize_term(force_terms))
        if legacy is not None:
            selected = set(legacy)
            if atmospheric_drag:
                selected.add("drag")
            return tuple(term for term in _FORCE_TERM_ORDER if term in selected)
        raw_terms = [piece for piece in force_terms.replace(",", " ").replace("+", " ").split() if piece]
    else:
        raw_terms = list(force_terms)

    selected = {"central"}
    for raw_term in raw_terms:
        canonical = _FORCE_TERM_ALIASES.get(_normalize_term(raw_term))
        if canonical is None:
            available = ", ".join(_FORCE_TERM_ORDER)
            raise ValueError(f"Término de fuerza Cowell no compatible: {raw_term}. Disponibles: {available}")
        selected.add(canonical)
    return tuple(term for term in _FORCE_TERM_ORDER if term in selected)


def _legacy_gravity_model(force_terms: tuple[str, ...]) -> str | None:
    """Return an old gravity-preset spelling only for exact equivalents."""

    gravity_terms = tuple(term for term in force_terms if term != "drag")
    for model, candidate in _GRAVITY_MODELS.items():
        if gravity_terms == candidate:
            return model
    return None


def _state_from_mapping(state_vector: Mapping[str, object]) -> _STATE:
    try:
        position = state_vector.get("position_eme2000_km", state_vector.get("position_eci_km"))
        velocity = state_vector.get("velocity_eme2000_km_s", state_vector.get("velocity_eci_km_s"))
    except AttributeError as exc:
        raise ValueError("Falta el vector de estado EME2000 canÃ³nico") from exc
    if position is None or velocity is None:
        raise ValueError("Falta el vector de estado EME2000 canÃ³nico")
    if not isinstance(position, Mapping) or not isinstance(velocity, Mapping):
        raise ValueError("El vector de estado EME2000 debe contener posiciÃ³n y velocidad")
    result = (
        _finite(position.get("x"), "La posiciÃ³n X"),
        _finite(position.get("y"), "La posiciÃ³n Y"),
        _finite(position.get("z"), "La posiciÃ³n Z"),
        _finite(velocity.get("x"), "La velocidad X"),
        _finite(velocity.get("y"), "La velocidad Y"),
        _finite(velocity.get("z"), "La velocidad Z"),
    )
    radius = math.sqrt((result[0] ** 2) + (result[1] ** 2) + (result[2] ** 2))
    if radius <= EARTH_EQUATORIAL_RADIUS_KM:
        raise ValueError("El vector de estado comienza dentro de la Tierra")
    return result


def _geodetic_altitude_km(x_km: float, y_km: float, z_km: float) -> float:
    """Return an efficient WGS-84 geodetic altitude for the atmosphere model."""

    equatorial_radius = EARTH_EQUATORIAL_RADIUS_KM
    polar_radius = WGS84_POLAR_RADIUS_KM
    eccentricity_sq = 1.0 - ((polar_radius * polar_radius) / (equatorial_radius * equatorial_radius))
    second_eccentricity_sq = (
        (equatorial_radius * equatorial_radius) - (polar_radius * polar_radius)
    ) / (polar_radius * polar_radius)
    horizontal = math.hypot(x_km, y_km)
    if horizontal < 1e-10:
        return abs(z_km) - polar_radius
    theta = math.atan2(z_km * equatorial_radius, horizontal * polar_radius)
    sin_theta, cos_theta = math.sin(theta), math.cos(theta)
    latitude = math.atan2(
        z_km + (second_eccentricity_sq * polar_radius * (sin_theta ** 3)),
        horizontal - (eccentricity_sq * equatorial_radius * (cos_theta ** 3)),
    )
    sine = math.sin(latitude)
    radius_of_curvature = equatorial_radius / math.sqrt(1.0 - (eccentricity_sq * sine * sine))
    return (horizontal / math.cos(latitude)) - radius_of_curvature


def _atmospheric_density_kg_m3(altitude_km: float) -> float:
    """Approximate neutral-density value for a geometric altitude."""

    if altitude_km >= _ATMOSPHERE_CEILING_KM:
        return 0.0
    # Keep an obviously invalid below-surface trial state from producing an
    # exponential overflow during an RK sub-step.  The propagator reports a
    # physically meaningful failure before any such state reaches a result.
    altitude = max(-10.0, float(altitude_km))
    base_altitude, base_density, scale_height = _EXPONENTIAL_ATMOSPHERE[0]
    for candidate in _EXPONENTIAL_ATMOSPHERE:
        if candidate[0] > altitude:
            break
        base_altitude, base_density, scale_height = candidate
    return base_density * math.exp(-(altitude - base_altitude) / scale_height)


def _legendre_and_derivative(degree: int, sine_latitude: float) -> tuple[float, float]:
    """Return P_n(q) and dP_n/dq for the supported zonal harmonics."""

    q = max(-1.0, min(1.0, sine_latitude))
    if degree == 2:
        return ((3.0 * q * q) - 1.0) / 2.0, 3.0 * q
    if degree == 3:
        return ((5.0 * q ** 3) - (3.0 * q)) / 2.0, ((15.0 * q * q) - 3.0) / 2.0
    if degree == 4:
        return ((35.0 * q ** 4) - (30.0 * q * q) + 3.0) / 8.0, ((140.0 * q ** 3) - (60.0 * q)) / 8.0
    raise ValueError(f"ArmÃ³nico zonal J{degree} no compatible")


class CowellPropagator:
    """Numerically integrate explicit central/J2/J3/J4/drag force terms.

    The per-instance state cache is intentional.  ``OrbitRuntime`` samples an
    ephemeris in chronological order and calls both ITRF and ECI methods for a
    point.  Reusing the nearest state makes that O(number of integration
    steps), rather than reintegrating the whole history once per sample.
    """

    dynamics_reference_frame = FrameId.EME2000.value
    dynamics_reference_realization = None
    ephemeris_reference_frame = FrameId.ITRF.value
    ephemeris_reference_realization = None
    numerical_integrator = "Cowell RK4"
    integration_step_seconds = 60.0

    def __init__(
        self,
        epoch: datetime.datetime,
        state_vector: Mapping[str, object],
        *,
        force_terms: Iterable[str] | str | None = None,
        gravity_model: str | None = None,
        atmospheric_drag: bool = False,
        drag_coefficient: float = 2.2,
        area_m2: float = 1.0,
        mass_kg: float = 100.0,
        geopotential_model: GravityFieldModel | None = None,
        geopotential_degree: int = 4,
        geopotential_order: int = 0,
        solar_radiation_coefficient: float = 1.2,
        celestial_ephemeris: CelestialEphemeris | None = None,
        frame_transformer: FrameTransformService | None = None,
    ) -> None:
        if force_terms is None:
            legacy_model = gravity_model or "two-body"
            normalized_model = _normalize_term(legacy_model)
            if normalized_model not in _GRAVITY_MODELS:
                raise ValueError(f"Modelo de gravedad manual no compatible: {gravity_model}")
            terms = _normalize_force_terms(
                normalized_model,
                atmospheric_drag=atmospheric_drag,
            )
        else:
            # Modern callers select an explicit force composition. It is
            # authoritative over the old gravity_model/atmospheric_drag pair.
            terms = _normalize_force_terms(force_terms)
        self.epoch = ensure_utc(epoch)
        self.force_terms = terms
        if "geopotential" in terms and any(term in terms for term in ("j2", "j3", "j4")):
            raise ValueError(
                "geopotential no puede combinarse con j2, j3 o j4; "
                "el campo de grado/orden ya incluye esos arm\\u00f3nicos"
            )
        self.gravity_terms = tuple(term for term in terms if term in {"j2", "j3", "j4"})
        self.atmospheric_drag = "drag" in terms
        # Preserve the historical attribute for callers that only understand
        # the three old preset names. Custom independent combinations are
        # explicitly marked rather than rounded to a different physics model.
        self.gravity_model = _legacy_gravity_model(terms) or "custom"
        self.force_model_id = self.gravity_model if self.gravity_model != "custom" else "+".join(terms)
        # Keep the public propagator identity independent from the selected
        # force model. This avoids reporting a configurable Cowell/RK4 run as
        # if it were the fixed J2/J3/J4 preset.
        self.model_id = "cowell-rk4"
        self.drag_coefficient = _finite(drag_coefficient, "El coeficiente de arrastre")
        self.area_m2 = _finite(area_m2, "El \\u00e1rea de referencia")
        self.mass_kg = _finite(mass_kg, "La masa")
        self.solar_radiation_coefficient = _finite(
            solar_radiation_coefficient,
            "El coeficiente de reflexi\\u00f3n solar",
        )
        if self.drag_coefficient <= 0 or self.area_m2 <= 0 or self.mass_kg <= 0:
            raise ValueError("Los par\\u00e1metros de arrastre deben ser mayores que cero")
        if self.solar_radiation_coefficient <= 0:
            raise ValueError("El coeficiente de reflexi\\u00f3n solar debe ser mayor que cero")
        self.ballistic_coefficient_m2_kg = self.drag_coefficient * self.area_m2 / self.mass_kg
        self._frame_transformer = frame_transformer or FrameTransformService()
        self.geopotential_model = geopotential_model
        if "geopotential" in terms:
            if geopotential_model is None:
                raise ValueError(
                    "geopotential requiere un campo ICGEM local configurado y verificado"
                )
            if geopotential_degree < 2:
                raise ValueError(
                    "geopotential requiere grado >= 2; J1 no es un término seleccionable "
                    "en un campo centrado en el centro de masas"
                )
            try:
                self.geopotential_configuration = GeopotentialConfiguration(
                    geopotential_degree,
                    geopotential_order,
                )
                self.geopotential_configuration.validate_for(geopotential_model)
            except GravityFieldError as exc:
                raise ValueError(str(exc)) from exc
        else:
            self.geopotential_configuration = None
        self._celestial_ephemeris = celestial_ephemeris
        self._requires_celestial_ephemeris = bool(
            {"third-body-sun", "third-body-moon", "solar-radiation-pressure"}
            .intersection(terms)
        )
        if self._requires_celestial_ephemeris and celestial_ephemeris is not None:
            if not isinstance(celestial_ephemeris, CelestialEphemeris):
                raise TypeError("celestial_ephemeris debe ser CelestialEphemeris")
            # ``ForceEvaluationContext`` validates the transformer's local
            # UTC-to-TT snapshot at every RK stage.  An injected provider
            # must use the *same immutable table*, otherwise the guard and
            # the ERFA ephemeris could silently evaluate different TT epochs.
            if celestial_ephemeris.leap_seconds != self._frame_transformer.leap_second_table:
                raise ValueError(
                    "celestial_ephemeris debe usar la misma tabla local de segundos "
                    "intercalares que frame_transformer"
                )
            self._celestial_ephemeris = celestial_ephemeris
        initial = _state_from_mapping(state_vector)
        self._lock = threading.RLock()
        self._offsets: list[float] = [0.0]
        self._states: dict[float, _STATE] = {0.0: initial}

    @property
    def applied_engine(self) -> str:
        return "cowell-rk4"

    @property
    def frame_transformer(self) -> FrameTransformService:
        return self._frame_transformer

    @property
    def celestial_ephemeris(self) -> CelestialEphemeris:
        """Return the local ERFA source pinned to this Cowell instance."""

        if self._celestial_ephemeris is None:
            leap_seconds = self._frame_transformer.leap_second_table
            self._celestial_ephemeris = CelestialEphemeris(
                leap_seconds=leap_seconds,
                require_unexpired_leap_seconds=True,
            )
        return self._celestial_ephemeris

    def _force_context(self, offset_seconds: float) -> ForceEvaluationContext:
        return ForceEvaluationContext(
            self.epoch + datetime.timedelta(seconds=float(offset_seconds)),
            self._frame_transformer,
        )

    @staticmethod
    def _add_vector(
        total: tuple[float, float, float],
        addition: tuple[float, float, float],
    ) -> tuple[float, float, float]:
        return tuple(
            total[index] + addition[index] for index in range(3)
        )  # type: ignore[return-value]

    def _geopotential_acceleration(
        self,
        state: _STATE,
        offset_seconds: float,
    ) -> tuple[float, float, float]:
        if self.geopotential_model is None or self.geopotential_configuration is None:
            raise ValueError("geopotential requiere un campo ICGEM configurado")
        try:
            context = self._force_context(offset_seconds)
            position_itrf_km, _velocity_itrf = context.eme2000_state_to_itrf(state[:3], state[3:])
            perturbation_itrf = geopotential_perturbation_acceleration_itrf(
                position_itrf_km,
                self.geopotential_model,
                self.geopotential_configuration,
            )
            return context.itrf_free_vector_to_eme2000(perturbation_itrf)
        except (ForceEvaluationError, GravityFieldError) as exc:
            raise ValueError(f"No se pudo evaluar geopotential: {exc}") from exc

    def _earth_fixed_drag_acceleration(
        self,
        state: _STATE,
        offset_seconds: float,
    ) -> tuple[float, float, float]:
        """Evaluate the simple co-rotating atmosphere in ITRF.

        The density law remains an intentionally first-order engineering
        approximation, but its latitude/altitude and relative velocity are
        evaluated in the rotating Earth frame at the actual RK-stage epoch.
        A strict IAU/EOP route is mandatory; the old inertial-axis shortcut is
        not used for newly evaluated drag.
        """

        try:
            context = self._force_context(offset_seconds)
            position_itrf_km, velocity_itrf_km_s = context.eme2000_state_to_itrf(
                state[:3], state[3:]
            )
            if velocity_itrf_km_s is None:  # State has a velocity by contract.
                raise ValueError("La velocidad ITRF es obligatoria para el arrastre")
            density_kg_m3 = _atmospheric_density_kg_m3(
                _geodetic_altitude_km(*position_itrf_km)
            )
            if density_kg_m3 == 0.0:
                return 0.0, 0.0, 0.0
            speed_m_s = 1_000.0 * math.sqrt(sum(
                component * component for component in velocity_itrf_km_s
            ))
            multiplier = -0.5 * self.ballistic_coefficient_m2_kg * density_kg_m3 * speed_m_s
            drag_itrf = tuple(
                multiplier * component for component in velocity_itrf_km_s
            )
            return context.itrf_free_vector_to_eme2000(drag_itrf)
        except ForceEvaluationError as exc:
            raise ValueError(f"No se pudo evaluar drag: {exc}") from exc

    def _celestial_position_eme2000_m(
        self,
        body: str,
        offset_seconds: float,
    ) -> tuple[float, float, float]:
        """Transform one local ERFA body state into the Cowell native frame."""

        context = self._force_context(offset_seconds)
        # A third-body/SRP vector stays in an inertial frame. It requires
        # ERFA and an auditable UTC-to-TT table, but not UT1/polar motion or an
        # ITRF EOP sample: those belong only to Earth-fixed forces.
        context.require_inertial_time_route()
        try:
            eme2000_state = self.celestial_ephemeris.eme2000_state_at(
                body,
                context.epoch_utc,
            )
        except (CelestialEphemerisError, ForceEvaluationError) as exc:
            raise ValueError(f"No se pudo evaluar la efem\\u00e9ride {body}: {exc}") from exc
        return eme2000_state.position_m

    def _celestial_acceleration(
        self,
        state: _STATE,
        offset_seconds: float,
    ) -> tuple[float, float, float]:
        satellite_m = tuple(component * 1_000.0 for component in state[:3])
        total_m_s2 = (0.0, 0.0, 0.0)
        try:
            sun_position_m: tuple[float, float, float] | None = None
            if any(
                term in self.force_terms
                for term in ("third-body-sun", "solar-radiation-pressure")
            ):
                sun_position_m = self._celestial_position_eme2000_m(SUN_BODY, offset_seconds)
            if "third-body-sun" in self.force_terms:
                total_m_s2 = self._add_vector(
                    total_m_s2,
                    differential_third_body_acceleration(
                        satellite_m,
                        sun_position_m,
                        SUN_GRAVITATIONAL_PARAMETER_M3_S2,
                    ),
                )
            if "third-body-moon" in self.force_terms:
                moon_position_m = self._celestial_position_eme2000_m(MOON_BODY, offset_seconds)
                total_m_s2 = self._add_vector(
                    total_m_s2,
                    differential_third_body_acceleration(
                        satellite_m,
                        moon_position_m,
                        MOON_GRAVITATIONAL_PARAMETER_M3_S2,
                    ),
                )
            if "solar-radiation-pressure" in self.force_terms:
                if sun_position_m is None:  # Defensive invariant above.
                    raise ValueError("Falta la posici\\u00f3n solar para SRP")
                eclipse = cylindrical_umbra_eclipse_factor(satellite_m, sun_position_m)
                total_m_s2 = self._add_vector(
                    total_m_s2,
                    cannonball_solar_radiation_pressure_acceleration(
                        satellite_m,
                        sun_position_m,
                        reflectivity_coefficient=self.solar_radiation_coefficient,
                        area_m2=self.area_m2,
                        mass_kg=self.mass_kg,
                        eclipse_factor=eclipse,
                    ),
                )
        except CelestialEphemerisError as exc:
            raise ValueError(f"No se pudo evaluar la fuerza celeste: {exc}") from exc
        return tuple(component / 1_000.0 for component in total_m_s2)  # type: ignore[return-value]

    @staticmethod
    def _schwarzschild_acceleration(state: _STATE) -> tuple[float, float, float]:
        """Return the first-order Schwarzschild correction in km/s\\u00b2.

        This is the standard non-spinning monopole term in a geocentric
        inertial frame.  It is intentionally a separate selectable force and
        does not claim to model Earth spin, multipoles or relativistic tides.
        """

        position = state[:3]
        velocity = state[3:]
        radius = math.sqrt(sum(component * component for component in position))
        if radius <= 0.0:
            raise ValueError("La correcci\\u00f3n relativista no admite el origen terrestre")
        velocity_squared = sum(component * component for component in velocity)
        radial_velocity = sum(
            position[index] * velocity[index] for index in range(3)
        )
        factor = EARTH_MU_KM3_S2 / ((_SPEED_OF_LIGHT_KM_S ** 2) * (radius ** 3))
        acceleration = tuple(
            factor
            * (
                ((4.0 * EARTH_MU_KM3_S2 / radius) - velocity_squared) * position[index]
                + (4.0 * radial_velocity * velocity[index])
            )
            for index in range(3)
        )
        if not all(math.isfinite(component) for component in acceleration):
            raise ValueError("La correcci\\u00f3n relativista no es finita")
        return acceleration  # type: ignore[return-value]

    def _acceleration(
        self,
        state: _STATE,
        offset_seconds: float = 0.0,
    ) -> tuple[float, float, float]:
        x, y, z, vx, vy, vz = state
        radius_sq = (x * x) + (y * y) + (z * z)
        radius = math.sqrt(radius_sq)
        if radius <= WGS84_POLAR_RADIUS_KM:
            raise ValueError("La propagaci\\u00f3n intersecta la Tierra; reduce el intervalo o desactiva el arrastre")
        inv_radius_cubed = 1.0 / (radius_sq * radius)
        ax = -EARTH_MU_KM3_S2 * x * inv_radius_cubed
        ay = -EARTH_MU_KM3_S2 * y * inv_radius_cubed
        az = -EARTH_MU_KM3_S2 * z * inv_radius_cubed

        if self.gravity_terms:
            sine_latitude = z / radius
            # Derivative of -mu*J_n*R^n*r^-(n+1) P_n(z/r).  This generic
            # form avoids inconsistent sign conventions between J2/J3/J4.
            for degree in range(2, 5):
                if f"j{degree}" not in self.gravity_terms:
                    continue
                coefficient = _ZONAL_COEFFICIENTS[degree]
                polynomial, derivative = _legendre_and_derivative(degree, sine_latitude)
                scale = EARTH_MU_KM3_S2 * coefficient * (EARTH_EQUATORIAL_RADIUS_KM ** degree)
                transverse = ((degree + 1.0) * polynomial) + (sine_latitude * derivative)
                vertical = ((degree + 1.0) * sine_latitude * polynomial) - ((1.0 - (sine_latitude ** 2)) * derivative)
                ax += scale * x * transverse / (radius ** (degree + 3))
                ay += scale * y * transverse / (radius ** (degree + 3))
                az += scale * vertical / (radius ** (degree + 2))

        if "geopotential" in self.force_terms:
            geopotential = self._geopotential_acceleration(state, offset_seconds)
            ax += geopotential[0]
            ay += geopotential[1]
            az += geopotential[2]

        if self.atmospheric_drag:
            drag = self._earth_fixed_drag_acceleration(state, offset_seconds)
            ax += drag[0]
            ay += drag[1]
            az += drag[2]
        if self._requires_celestial_ephemeris:
            celestial = self._celestial_acceleration(state, offset_seconds)
            ax += celestial[0]
            ay += celestial[1]
            az += celestial[2]
        if "relativity" in self.force_terms:
            relativity = self._schwarzschild_acceleration(state)
            ax += relativity[0]
            ay += relativity[1]
            az += relativity[2]
        return ax, ay, az

    def _derivative(self, state: _STATE, offset_seconds: float = 0.0) -> _STATE:
        ax, ay, az = self._acceleration(state, offset_seconds)
        return state[3], state[4], state[5], ax, ay, az

    @staticmethod
    def _advance(state: _STATE, derivative: _STATE, seconds: float) -> _STATE:
        return tuple(value + (seconds * rate) for value, rate in zip(state, derivative, strict=True))  # type: ignore[return-value]

    def _rk4_step(
        self,
        state: _STATE,
        seconds: float,
        start_offset_seconds: float = 0.0,
    ) -> _STATE:
        """Take one RK4 step, evaluating time-dependent forces at each stage."""

        first = self._derivative(state, start_offset_seconds)
        second = self._derivative(
            self._advance(state, first, seconds / 2.0),
            start_offset_seconds + (seconds / 2.0),
        )
        third = self._derivative(
            self._advance(state, second, seconds / 2.0),
            start_offset_seconds + (seconds / 2.0),
        )
        fourth = self._derivative(
            self._advance(state, third, seconds),
            start_offset_seconds + seconds,
        )
        return tuple(
            value + (seconds / 6.0) * (one + (2.0 * two) + (2.0 * three) + four)
            for value, one, two, three, four in zip(state, first, second, third, fourth, strict=True)
        )  # type: ignore[return-value]

    def _integrate(
        self,
        initial: _STATE,
        duration_seconds: float,
        start_offset_seconds: float = 0.0,
    ) -> _STATE:
        remaining = float(duration_seconds)
        state = initial
        current_offset = float(start_offset_seconds)
        while abs(remaining) > 1e-9:
            step = math.copysign(min(self.integration_step_seconds, abs(remaining)), remaining)
            state = self._rk4_step(state, step, current_offset)
            remaining -= step
            current_offset += step
        return state

    def _state_at_offset(self, target_offset_seconds: float) -> _STATE:
        target = float(target_offset_seconds)
        with self._lock:
            cached = self._states.get(target)
            if cached is not None:
                return cached
            insertion = bisect.bisect_left(self._offsets, target)
            candidates: list[float] = []
            if insertion:
                candidates.append(self._offsets[insertion - 1])
            if insertion < len(self._offsets):
                candidates.append(self._offsets[insertion])
            source_offset = min(candidates, key=lambda value: abs(value - target))
            propagated = self._integrate(
                self._states[source_offset],
                target - source_offset,
                source_offset,
            )
            self._states[target] = propagated
            self._offsets.insert(insertion, target)
            return propagated

    def propagate_eme2000_datetime(self, instant: datetime.datetime) -> _STATE:
        """Return the declared native EME2000 compatibility state in km/km/s."""

        utc = ensure_utc(instant)
        return self._state_at_offset((utc - self.epoch).total_seconds())

    def propagate_eci_datetime(self, instant: datetime.datetime) -> _STATE:
        """Legacy alias for :meth:`propagate_eme2000_datetime`."""

        return self.propagate_eme2000_datetime(instant)

    def native_state_at(self, instant: datetime.datetime) -> StateVector:
        utc = ensure_utc(instant)
        x, y, z, vx, vy, vz = self.propagate_eme2000_datetime(utc)
        return StateVector.from_kilometres(
            epoch=utc,
            time_scale="UTC",
            frame=FrameId.EME2000,
            frame_realization=None,
            center="EARTH",
            position_km=(x, y, z),
            velocity_km_s=(vx, vy, vz),
            provenance={
                "source": "manual",
                "propagator": self.model_id,
                "native_frame": "EME2000",
                "legacy_input_assumption": "previous ECI manual states are interpreted as EME2000",
                "model_limit": (
                    "Legacy j2/j3/j4 use the compatibility inertial-axis model; "
                    "Earth-fixed drag and configured geopotential are evaluated through "
                    "strict EME2000 -> ITRF -> EME2000"
                ),
            },
        )

    def state_at(
        self,
        instant: datetime.datetime,
        *,
        target_frame: FrameId | str = FrameId.ITRF,
        target_realization: str | None = None,
    ) -> StateVector:
        return self._frame_transformer.transform(
            self.native_state_at(instant),
            target_frame=target_frame,
            target_realization=target_realization,
        )

    def propagate_datetime(self, instant: datetime.datetime) -> _STATE:
        return self.state_at(instant, target_frame=FrameId.ITRF).components()

    def propagate(self) -> _STATE:
        return self.propagate_datetime(utc_now())

    def propagate_offset(self, seconds: float) -> _STATE:
        return self.propagate_datetime(utc_now() + datetime.timedelta(seconds=float(seconds)))

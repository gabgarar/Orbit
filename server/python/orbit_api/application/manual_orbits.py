"""Pure manual-orbit conversion and synthetic TLE generation helpers.

The editor deliberately keeps this capability transient: the resulting TLE is
only used to instantiate an SGP4 propagator for the current request and is
never written to the catalogue.  Classical elements and Cartesian states are
expressed in ECI kilometres / kilometres per second at the supplied epoch.
"""

from __future__ import annotations

import datetime
import hashlib
import math
from typing import Any

from orbit_api.domain.requests import ManualKeplerianInput, ManualOrbitRequest, ManualStateVectorInput


EARTH_MU_KM3_S2 = 398600.4418
EARTH_EQUATORIAL_RADIUS_KM = 6378.137
_TWO_PI = 2.0 * math.pi
_DEG_TO_RAD = math.pi / 180.0
_RAD_TO_DEG = 180.0 / math.pi
_ECCENTRICITY_TOLERANCE = 1e-10


class ManualOrbitError(ValueError):
    """The supplied manual definition cannot represent a bounded orbit."""


def _vector(x: float, y: float, z: float) -> tuple[float, float, float]:
    values = (float(x), float(y), float(z))
    if not all(math.isfinite(value) for value in values):
        raise ManualOrbitError("Los vectores de estado deben contener valores finitos")
    return values


def _dot(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _cross(left: tuple[float, float, float], right: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        (left[1] * right[2]) - (left[2] * right[1]),
        (left[2] * right[0]) - (left[0] * right[2]),
        (left[0] * right[1]) - (left[1] * right[0]),
    )


def _scale(vector: tuple[float, float, float], factor: float) -> tuple[float, float, float]:
    return tuple(component * factor for component in vector)


def _subtract(left: tuple[float, float, float], right: tuple[float, float, float]) -> tuple[float, float, float]:
    return tuple(a - b for a, b in zip(left, right, strict=True))


def _magnitude(vector: tuple[float, float, float]) -> float:
    return math.sqrt(_dot(vector, vector))


def _wrap_radians(value: float) -> float:
    wrapped = value % _TWO_PI
    return 0.0 if math.isclose(wrapped, _TWO_PI, abs_tol=1e-14) else wrapped


def _normalize_degrees(value: float) -> float:
    wrapped = float(value) % 360.0
    return 0.0 if math.isclose(wrapped, 360.0, abs_tol=1e-12) else wrapped


def _clamped_acos(value: float) -> float:
    return math.acos(max(-1.0, min(1.0, value)))


def _true_to_mean_anomaly_deg(true_anomaly_deg: float, eccentricity: float) -> float:
    true_anomaly = _normalize_degrees(true_anomaly_deg) * _DEG_TO_RAD
    eccentric_anomaly = 2.0 * math.atan2(
        math.sqrt(1.0 - eccentricity) * math.sin(true_anomaly / 2.0),
        math.sqrt(1.0 + eccentricity) * math.cos(true_anomaly / 2.0),
    )
    eccentric_anomaly = _wrap_radians(eccentric_anomaly)
    return _normalize_degrees((eccentric_anomaly - (eccentricity * math.sin(eccentric_anomaly))) * _RAD_TO_DEG)


def _mean_to_true_anomaly_deg(mean_anomaly_deg: float, eccentricity: float) -> float:
    mean_anomaly = _normalize_degrees(mean_anomaly_deg) * _DEG_TO_RAD
    signed_mean = mean_anomaly if mean_anomaly <= math.pi else mean_anomaly - _TWO_PI
    eccentric_anomaly = signed_mean if eccentricity < 0.8 else (math.pi if signed_mean >= 0 else -math.pi)
    for _ in range(60):
        residual = eccentric_anomaly - (eccentricity * math.sin(eccentric_anomaly)) - signed_mean
        correction = residual / (1.0 - (eccentricity * math.cos(eccentric_anomaly)))
        eccentric_anomaly -= correction
        if abs(correction) < 1e-13:
            true_anomaly = 2.0 * math.atan2(
                math.sqrt(1.0 + eccentricity) * math.sin(eccentric_anomaly / 2.0),
                math.sqrt(1.0 - eccentricity) * math.cos(eccentric_anomaly / 2.0),
            )
            return _normalize_degrees(true_anomaly * _RAD_TO_DEG)
    raise ManualOrbitError("La ecuación de Kepler no converge con los valores proporcionados")


def _orbit_derived_values(semi_major_axis_km: float, eccentricity: float) -> dict[str, float]:
    period_seconds = _TWO_PI * math.sqrt((semi_major_axis_km ** 3) / EARTH_MU_KM3_S2)
    mean_motion_rad_s = _TWO_PI / period_seconds
    return {
        "semi_latus_rectum_km": semi_major_axis_km * (1.0 - (eccentricity * eccentricity)),
        "periapsis_radius_km": semi_major_axis_km * (1.0 - eccentricity),
        "apoapsis_radius_km": semi_major_axis_km * (1.0 + eccentricity),
        "orbital_period_seconds": period_seconds,
        "mean_motion_rev_day": mean_motion_rad_s * 86400.0 / _TWO_PI,
    }


def _validate_clearance(semi_major_axis_km: float, eccentricity: float) -> None:
    perigee_radius = semi_major_axis_km * (1.0 - eccentricity)
    if not math.isfinite(perigee_radius) or perigee_radius <= EARTH_EQUATORIAL_RADIUS_KM:
        raise ManualOrbitError(
            f"El perigeo debe quedar por encima del radio ecuatorial terrestre ({EARTH_EQUATORIAL_RADIUS_KM:.3f} km)"
        )


def keplerian_to_state_vector(elements: ManualKeplerianInput) -> tuple[dict[str, float], dict[str, Any]]:
    """Derive an ECI Cartesian state from classical elliptic elements."""

    semi_major_axis = float(elements.semi_major_axis_km)
    eccentricity = float(elements.eccentricity)
    _validate_clearance(semi_major_axis, eccentricity)
    semi_latus_rectum = semi_major_axis * (1.0 - (eccentricity * eccentricity))
    if not semi_latus_rectum > 0:
        raise ManualOrbitError("Los elementos no describen una órbita elíptica válida")

    inclination_deg = float(elements.inclination_deg)
    raan_deg = _normalize_degrees(elements.raan_deg)
    argument_of_perigee_deg = _normalize_degrees(elements.argument_of_perigee_deg)
    if elements.true_anomaly_deg is not None:
        true_anomaly_deg = _normalize_degrees(elements.true_anomaly_deg)
        mean_anomaly_deg = _true_to_mean_anomaly_deg(true_anomaly_deg, eccentricity)
    else:
        mean_anomaly_deg = _normalize_degrees(elements.mean_anomaly_deg or 0.0)
        true_anomaly_deg = _mean_to_true_anomaly_deg(mean_anomaly_deg, eccentricity)

    inclination = inclination_deg * _DEG_TO_RAD
    raan = raan_deg * _DEG_TO_RAD
    argument = argument_of_perigee_deg * _DEG_TO_RAD
    true_anomaly = true_anomaly_deg * _DEG_TO_RAD
    radius = semi_latus_rectum / (1.0 + (eccentricity * math.cos(true_anomaly)))
    velocity_scale = math.sqrt(EARTH_MU_KM3_S2 / semi_latus_rectum)
    position_perifocal = (radius * math.cos(true_anomaly), radius * math.sin(true_anomaly), 0.0)
    velocity_perifocal = (
        -velocity_scale * math.sin(true_anomaly),
        velocity_scale * (eccentricity + math.cos(true_anomaly)),
        0.0,
    )

    cos_raan, sin_raan = math.cos(raan), math.sin(raan)
    cos_i, sin_i = math.cos(inclination), math.sin(inclination)
    cos_arg, sin_arg = math.cos(argument), math.sin(argument)
    rotation = (
        ((cos_raan * cos_arg) - (sin_raan * sin_arg * cos_i), (-cos_raan * sin_arg) - (sin_raan * cos_arg * cos_i)),
        ((sin_raan * cos_arg) + (cos_raan * sin_arg * cos_i), (-sin_raan * sin_arg) + (cos_raan * cos_arg * cos_i)),
        (sin_arg * sin_i, cos_arg * sin_i),
    )

    def rotate(perifocal: tuple[float, float, float]) -> dict[str, float]:
        return {
            "x": (rotation[0][0] * perifocal[0]) + (rotation[0][1] * perifocal[1]),
            "y": (rotation[1][0] * perifocal[0]) + (rotation[1][1] * perifocal[1]),
            "z": (rotation[2][0] * perifocal[0]) + (rotation[2][1] * perifocal[1]),
        }

    keplerian = {
        "semi_major_axis_km": semi_major_axis,
        "eccentricity": eccentricity,
        "inclination_deg": inclination_deg,
        "raan_deg": raan_deg,
        "argument_of_perigee_deg": argument_of_perigee_deg,
        "true_anomaly_deg": true_anomaly_deg,
        "mean_anomaly_deg": mean_anomaly_deg,
        "reference_frame": "ECI",
        **_orbit_derived_values(semi_major_axis, eccentricity),
    }
    state_vector = {
        "reference_frame": "ECI",
        "position_eci_km": rotate(position_perifocal),
        "velocity_eci_km_s": rotate(velocity_perifocal),
    }
    return keplerian, state_vector


def state_vector_to_keplerian(state: ManualStateVectorInput) -> tuple[dict[str, float], dict[str, Any]]:
    """Derive classical elliptic elements from an ECI Cartesian state."""

    position = _vector(state.position_eci_km.x, state.position_eci_km.y, state.position_eci_km.z)
    velocity = _vector(state.velocity_eci_km_s.x, state.velocity_eci_km_s.y, state.velocity_eci_km_s.z)
    radius = _magnitude(position)
    velocity_magnitude = _magnitude(velocity)
    if radius <= 0 or velocity_magnitude <= 0:
        raise ManualOrbitError("La posición y la velocidad no pueden ser vectores nulos")

    angular_momentum = _cross(position, velocity)
    angular_momentum_magnitude = _magnitude(angular_momentum)
    if angular_momentum_magnitude <= 0:
        raise ManualOrbitError("El vector de estado tiene momento angular nulo")
    specific_energy = ((velocity_magnitude * velocity_magnitude) / 2.0) - (EARTH_MU_KM3_S2 / radius)
    if not specific_energy < 0:
        raise ManualOrbitError("Solo se admiten vectores de estado de órbitas elípticas ligadas")

    semi_major_axis = -EARTH_MU_KM3_S2 / (2.0 * specific_energy)
    eccentricity_vector = _subtract(
        _scale(position, ((velocity_magnitude * velocity_magnitude) - (EARTH_MU_KM3_S2 / radius)) / EARTH_MU_KM3_S2),
        _scale(velocity, _dot(position, velocity) / EARTH_MU_KM3_S2),
    )
    raw_eccentricity = _magnitude(eccentricity_vector)
    if raw_eccentricity >= 1.0:
        raise ManualOrbitError("Solo se admiten vectores de estado con excentricidad inferior a uno")
    eccentricity = 0.0 if raw_eccentricity < _ECCENTRICITY_TOLERANCE else raw_eccentricity
    _validate_clearance(semi_major_axis, eccentricity)

    node = (-angular_momentum[1], angular_momentum[0], 0.0)
    node_magnitude = _magnitude(node)
    inclination = _clamped_acos(angular_momentum[2] / angular_momentum_magnitude)
    equatorial = node_magnitude <= (angular_momentum_magnitude * _ECCENTRICITY_TOLERANCE)
    circular = eccentricity == 0.0
    retrograde_equatorial = equatorial and angular_momentum[2] < 0
    raan = 0.0 if equatorial else _wrap_radians(math.atan2(node[1], node[0]))

    argument_of_perigee = 0.0
    if not circular:
        if equatorial:
            longitude_of_perigee = math.atan2(eccentricity_vector[1], eccentricity_vector[0])
            argument_of_perigee = _wrap_radians(-longitude_of_perigee if retrograde_equatorial else longitude_of_perigee)
        else:
            argument_of_perigee = _clamped_acos(_dot(node, eccentricity_vector) / (node_magnitude * eccentricity))
            if eccentricity_vector[2] < 0:
                argument_of_perigee = _TWO_PI - argument_of_perigee
        true_anomaly = _clamped_acos(_dot(eccentricity_vector, position) / (eccentricity * radius))
        if _dot(position, velocity) < 0:
            true_anomaly = _TWO_PI - true_anomaly
    elif equatorial:
        true_longitude = math.atan2(position[1], position[0])
        true_anomaly = _wrap_radians(-true_longitude if retrograde_equatorial else true_longitude)
    else:
        true_anomaly = _clamped_acos(_dot(node, position) / (node_magnitude * radius))
        if position[2] < 0:
            true_anomaly = _TWO_PI - true_anomaly

    true_anomaly_deg = _normalize_degrees(true_anomaly * _RAD_TO_DEG)
    keplerian = {
        "semi_major_axis_km": semi_major_axis,
        "eccentricity": eccentricity,
        "inclination_deg": inclination * _RAD_TO_DEG,
        "raan_deg": _normalize_degrees(raan * _RAD_TO_DEG),
        "argument_of_perigee_deg": _normalize_degrees(argument_of_perigee * _RAD_TO_DEG),
        "true_anomaly_deg": true_anomaly_deg,
        "mean_anomaly_deg": _true_to_mean_anomaly_deg(true_anomaly_deg, eccentricity),
        "reference_frame": "ECI",
        **_orbit_derived_values(semi_major_axis, eccentricity),
    }
    state_vector = {
        "reference_frame": "ECI",
        "position_eci_km": {"x": position[0], "y": position[1], "z": position[2]},
        "velocity_eci_km_s": {"x": velocity[0], "y": velocity[1], "z": velocity[2]},
    }
    return keplerian, state_vector


def canonical_manual_orbit(payload: ManualOrbitRequest) -> tuple[str, dict[str, float], dict[str, Any]]:
    """Resolve the request's authoritative representation into both forms."""

    source = payload.definition_source
    if source is None:
        source = "keplerian" if payload.keplerian is not None else "state_vector"
    if source == "state_vector":
        if payload.state_vector is None:  # Covered by Pydantic; retained for type narrowing.
            raise ManualOrbitError("Falta el vector de estado")
        keplerian, state_vector = state_vector_to_keplerian(payload.state_vector)
    else:
        if payload.keplerian is None:  # Covered by Pydantic; retained for type narrowing.
            raise ManualOrbitError("Faltan los elementos keplerianos")
        keplerian, state_vector = keplerian_to_state_vector(payload.keplerian)
    return source, keplerian, state_vector


def tle_checksum(line_without_checksum: str) -> int:
    """Return the NORAD checksum for an exactly 68-character TLE line."""

    if len(line_without_checksum) != 68:
        raise ManualOrbitError("Una línea TLE sin checksum debe tener 68 caracteres")
    total = 0
    for character in line_without_checksum:
        if character.isdigit():
            total += int(character)
        elif character == "-":
            total += 1
    return total % 10


def is_valid_tle_checksum(line: str) -> bool:
    """Return whether a complete, fixed-width TLE line has a valid checksum."""

    return len(line) == 69 and line[-1].isdigit() and tle_checksum(line[:-1]) == int(line[-1])


def _tle_epoch(epoch: datetime.datetime) -> str:
    utc_epoch = epoch.replace(tzinfo=datetime.UTC) if epoch.tzinfo is None else epoch.astimezone(datetime.UTC)
    year_start = datetime.datetime(utc_epoch.year, 1, 1, tzinfo=datetime.UTC)
    day_of_year = 1.0 + ((utc_epoch - year_start).total_seconds() / 86400.0)
    days_in_year = 366 if (datetime.date(utc_epoch.year, 12, 31).timetuple().tm_yday == 366) else 365
    # Rounding to the eight TLE fractional-day digits can cross the year
    # boundary for the last microseconds of December 31.
    if round(day_of_year, 8) >= days_in_year + 1:
        utc_epoch = datetime.datetime(utc_epoch.year + 1, 1, 1, tzinfo=datetime.UTC)
        year_start, day_of_year = utc_epoch, 1.0
    return f"{utc_epoch.year % 100:02d}{day_of_year:012.8f}"


def _synthetic_identifiers(name: str, epoch: datetime.datetime, keplerian: dict[str, float]) -> tuple[int, int]:
    material = "|".join((
        name,
        epoch.isoformat(),
        f"{keplerian['semi_major_axis_km']:.9f}",
        f"{keplerian['eccentricity']:.12f}",
        f"{keplerian['mean_anomaly_deg']:.9f}",
    ))
    digest = int(hashlib.sha1(material.encode("utf-8")).hexdigest()[:12], 16)
    return 70_000 + (digest % 20_000), 1 + (digest % 99_999)


def build_synthetic_tle(name: str, epoch: datetime.datetime, keplerian: dict[str, float]) -> dict[str, Any]:
    """Build a valid checksum-protected TLE for the supplied mean elements."""

    semi_major_axis = float(keplerian["semi_major_axis_km"])
    eccentricity = float(keplerian["eccentricity"])
    _validate_clearance(semi_major_axis, eccentricity)
    mean_motion_rev_day = math.sqrt(EARTH_MU_KM3_S2 / (semi_major_axis ** 3)) * 86400.0 / _TWO_PI
    if not (math.isfinite(mean_motion_rev_day) and mean_motion_rev_day > 0):
        raise ManualOrbitError("No se pudo derivar el movimiento medio del TLE sintético")

    catalog_number, revolution_number = _synthetic_identifiers(name, epoch, keplerian)
    epoch_text = _tle_epoch(epoch)
    international_designator = f"{epoch.year % 100:02d}001MAN"
    inclination = float(keplerian["inclination_deg"])
    raan = _normalize_degrees(keplerian["raan_deg"])
    argument_of_perigee = _normalize_degrees(keplerian["argument_of_perigee_deg"])
    mean_anomaly = _normalize_degrees(keplerian["mean_anomaly_deg"])
    eccentricity_digits = min(9_999_999, max(0, int(round(eccentricity * 10_000_000))))

    line1_without_checksum = (
        f"1 {catalog_number:05d}U {international_designator:<8} {epoch_text}"
        "  .00000000  00000-0  00000-0 0  999"
    )
    line2_without_checksum = (
        f"2 {catalog_number:05d} {inclination:8.4f} {raan:8.4f} {eccentricity_digits:07d}"
        f" {argument_of_perigee:8.4f} {mean_anomaly:8.4f} {mean_motion_rev_day:11.8f}{revolution_number:05d}"
    )
    line1 = f"{line1_without_checksum}{tle_checksum(line1_without_checksum)}"
    line2 = f"{line2_without_checksum}{tle_checksum(line2_without_checksum)}"
    return {
        "line1": line1,
        "line2": line2,
        "synthetic": True,
        "catalog_number": catalog_number,
        "epoch": epoch.replace(tzinfo=datetime.UTC).isoformat() if epoch.tzinfo is None else epoch.astimezone(datetime.UTC).isoformat(),
    }

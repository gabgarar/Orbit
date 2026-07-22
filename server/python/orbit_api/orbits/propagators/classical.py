"""Small, dependency-free classical-orbit and Earth-fixed frame helpers.

Manual design starts from an ECI state at a user-selected epoch.  The native
Two-body and J2 engines evolve that state in ECI, then convert the result to
the ITRF/ECEF metres contract consumed by the existing renderer.  Keeping the
conversion here avoids treating a state-vector orbit as a synthetic TLE.
"""

from __future__ import annotations

import datetime
import math
from collections.abc import Mapping
from dataclasses import dataclass, replace


EARTH_MU_KM3_S2 = 398600.4418
EARTH_EQUATORIAL_RADIUS_KM = 6378.137
EARTH_ROTATION_RATE_RAD_S = 7.2921150e-5
_TWO_PI = 2.0 * math.pi


def _finite(value: object, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} debe ser numérico") from exc
    if not math.isfinite(result):
        raise ValueError(f"{label} debe ser finito")
    return result


def _wrap_radians(value: float) -> float:
    wrapped = value % _TWO_PI
    return 0.0 if math.isclose(wrapped, _TWO_PI, abs_tol=1e-14) else wrapped


def _signed_radians(value: float) -> float:
    wrapped = _wrap_radians(value)
    return wrapped - _TWO_PI if wrapped > math.pi else wrapped


def _solve_eccentric_anomaly(mean_anomaly_rad: float, eccentricity: float) -> float:
    """Solve the elliptic Kepler equation with a bounded Newton iteration."""

    mean = _signed_radians(mean_anomaly_rad)
    eccentric = mean if eccentricity < 0.8 else (math.pi if mean >= 0 else -math.pi)
    for _ in range(64):
        residual = eccentric - (eccentricity * math.sin(eccentric)) - mean
        derivative = 1.0 - (eccentricity * math.cos(eccentric))
        correction = residual / derivative
        eccentric -= correction
        if abs(correction) < 1e-13:
            return eccentric
    raise ValueError("La ecuación de Kepler no converge con los elementos proporcionados")


@dataclass(frozen=True)
class ClassicalElements:
    """Elliptic mean elements in radians and kilometres.

    This intentionally represents only bounded, Earth-centred elliptic
    orbits.  That is the contract already enforced by the manual editor and
    makes Two-body/J2 previews deterministic and numerically well behaved.
    """

    semi_major_axis_km: float
    eccentricity: float
    inclination_rad: float
    raan_rad: float
    argument_of_perigee_rad: float
    mean_anomaly_rad: float

    @classmethod
    def from_mapping(cls, values: Mapping[str, object]) -> "ClassicalElements":
        semi_major_axis = _finite(values.get("semi_major_axis_km"), "El semieje mayor")
        eccentricity = _finite(values.get("eccentricity"), "La excentricidad")
        inclination_deg = _finite(values.get("inclination_deg"), "La inclinación")
        raan_deg = _finite(values.get("raan_deg"), "El RAAN")
        argument_deg = _finite(values.get("argument_of_perigee_deg"), "El argumento de periapsis")
        mean_anomaly_deg = _finite(values.get("mean_anomaly_deg"), "La anomalía media")
        if semi_major_axis <= 0:
            raise ValueError("El semieje mayor debe ser positivo")
        if not 0 <= eccentricity < 1:
            raise ValueError("La excentricidad debe estar entre cero y uno")
        if not 0 <= inclination_deg <= 180:
            raise ValueError("La inclinación debe estar entre 0 y 180 grados")
        perigee_radius = semi_major_axis * (1.0 - eccentricity)
        if perigee_radius <= EARTH_EQUATORIAL_RADIUS_KM:
            raise ValueError("El perigeo debe quedar por encima del radio ecuatorial terrestre")
        return cls(
            semi_major_axis_km=semi_major_axis,
            eccentricity=eccentricity,
            inclination_rad=math.radians(inclination_deg),
            raan_rad=_wrap_radians(math.radians(raan_deg)),
            argument_of_perigee_rad=_wrap_radians(math.radians(argument_deg)),
            mean_anomaly_rad=_wrap_radians(math.radians(mean_anomaly_deg)),
        )

    @property
    def semi_latus_rectum_km(self) -> float:
        return self.semi_major_axis_km * (1.0 - (self.eccentricity * self.eccentricity))

    @property
    def mean_motion_rad_s(self) -> float:
        return math.sqrt(EARTH_MU_KM3_S2 / (self.semi_major_axis_km ** 3))

    @property
    def orbital_period_seconds(self) -> float:
        return _TWO_PI / self.mean_motion_rad_s

    def advanced(self, elapsed_seconds: float, *, raan_rate_rad_s: float = 0.0,
                 argument_of_perigee_rate_rad_s: float = 0.0,
                 mean_anomaly_rate_rad_s: float | None = None) -> "ClassicalElements":
        """Return elements advanced by secular rates from this epoch."""

        elapsed = _finite(elapsed_seconds, "El tiempo de propagación")
        mean_rate = self.mean_motion_rad_s if mean_anomaly_rate_rad_s is None else mean_anomaly_rate_rad_s
        return replace(
            self,
            raan_rad=_wrap_radians(self.raan_rad + (raan_rate_rad_s * elapsed)),
            argument_of_perigee_rad=_wrap_radians(
                self.argument_of_perigee_rad + (argument_of_perigee_rate_rad_s * elapsed)
            ),
            mean_anomaly_rad=_wrap_radians(self.mean_anomaly_rad + (mean_rate * elapsed)),
        )


def state_eci_from_mean_elements(elements: ClassicalElements) -> tuple[float, float, float, float, float, float]:
    """Return ECI position/velocity in km and km/s for elliptic mean elements."""

    eccentric_anomaly = _solve_eccentric_anomaly(elements.mean_anomaly_rad, elements.eccentricity)
    cosine, sine = math.cos(eccentric_anomaly), math.sin(eccentric_anomaly)
    a, e = elements.semi_major_axis_km, elements.eccentricity
    radius = a * (1.0 - (e * cosine))
    root = math.sqrt(1.0 - (e * e))
    position_perifocal = (a * (cosine - e), a * root * sine, 0.0)
    velocity_scale = math.sqrt(EARTH_MU_KM3_S2 * a) / radius
    velocity_perifocal = (-velocity_scale * sine, velocity_scale * root * cosine, 0.0)

    cos_raan, sin_raan = math.cos(elements.raan_rad), math.sin(elements.raan_rad)
    cos_i, sin_i = math.cos(elements.inclination_rad), math.sin(elements.inclination_rad)
    cos_argument, sin_argument = math.cos(elements.argument_of_perigee_rad), math.sin(elements.argument_of_perigee_rad)
    rotation = (
        (
            (cos_raan * cos_argument) - (sin_raan * sin_argument * cos_i),
            (-cos_raan * sin_argument) - (sin_raan * cos_argument * cos_i),
        ),
        (
            (sin_raan * cos_argument) + (cos_raan * sin_argument * cos_i),
            (-sin_raan * sin_argument) + (cos_raan * cos_argument * cos_i),
        ),
        (sin_argument * sin_i, cos_argument * sin_i),
    )

    def rotate(vector: tuple[float, float, float]) -> tuple[float, float, float]:
        return (
            (rotation[0][0] * vector[0]) + (rotation[0][1] * vector[1]),
            (rotation[1][0] * vector[0]) + (rotation[1][1] * vector[1]),
            (rotation[2][0] * vector[0]) + (rotation[2][1] * vector[1]),
        )

    position = rotate(position_perifocal)
    velocity = rotate(velocity_perifocal)
    return (*position, *velocity)


def ensure_utc(moment: datetime.datetime) -> datetime.datetime:
    """Interpret naive propagation timestamps as UTC, matching SGP4 routes."""

    if not isinstance(moment, datetime.datetime):
        raise ValueError("El instante de propagación debe ser una fecha y hora")
    return moment.replace(tzinfo=datetime.UTC) if moment.tzinfo is None else moment.astimezone(datetime.UTC)


def gmst_rad(moment: datetime.datetime) -> float:
    """Greenwich mean sidereal angle for a UTC instant.

    This is intentionally the same GMST convention used by the existing SGP4
    TEME-to-ITRF adapter, so all manual engines return the renderer's common
    Earth-fixed frame.
    """

    utc = ensure_utc(moment)
    unix_seconds = (utc - datetime.datetime(1970, 1, 1, tzinfo=datetime.UTC)).total_seconds()
    julian_date = 2440587.5 + (unix_seconds / 86400.0)
    centuries = (julian_date - 2451545.0) / 36525.0
    seconds = (
        67310.54841
        + (876600.0 * 3600.0 + 8640184.812866) * centuries
        + 0.093104 * (centuries ** 2)
        - 6.2e-6 * (centuries ** 3)
    )
    radians = math.fmod(math.radians(seconds / 240.0), _TWO_PI)
    return radians + _TWO_PI if radians < 0 else radians


def eci_to_itrf(
    x_km: float,
    y_km: float,
    z_km: float,
    vx_km_s: float,
    vy_km_s: float,
    vz_km_s: float,
    moment: datetime.datetime,
) -> tuple[float, float, float, float, float, float]:
    """Convert an ECI km/km/s state to ITRF metres/metres per second."""

    angle = gmst_rad(moment)
    cosine, sine = math.cos(angle), math.sin(angle)
    ecef_x_km = (x_km * cosine) + (y_km * sine)
    ecef_y_km = (-x_km * sine) + (y_km * cosine)
    rotated_vx_km_s = (vx_km_s * cosine) + (vy_km_s * sine)
    rotated_vy_km_s = (-vx_km_s * sine) + (vy_km_s * cosine)
    # r_ITRF = R3(-GMST) r_ECI, therefore the rotation derivative contributes
    # (+omega*y, -omega*x) in ITRF coordinates.
    # Keeping this sign explicit matters for velocity-vector displays and
    # state-vector round-trips; position-only ground tracks are unaffected.
    ecef_vx_km_s = rotated_vx_km_s + (EARTH_ROTATION_RATE_RAD_S * ecef_y_km)
    ecef_vy_km_s = rotated_vy_km_s - (EARTH_ROTATION_RATE_RAD_S * ecef_x_km)
    return (
        ecef_x_km * 1000.0,
        ecef_y_km * 1000.0,
        z_km * 1000.0,
        ecef_vx_km_s * 1000.0,
        ecef_vy_km_s * 1000.0,
        vz_km_s * 1000.0,
    )

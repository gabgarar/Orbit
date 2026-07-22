"""SGP4 implementation that converts TEME output to Cesium-compatible ECEF."""

import datetime
import math

from sgp4.api import Satrec, jday


_EARTH_ROTATION_RATE_RAD_S = 7.2921150e-5


class SGP4Propagator:
    """Propagate a two-line element set using the SGP4 model."""

    # SGP4 natively emits TEME.  The regular renderer adapter converts it to
    # ITRF, but analytical tools must be able to inspect the unrotated state
    # without pretending it is one of the ECI frames.
    dynamics_reference_frame = "TEME"
    ephemeris_reference_frame = "ITRF"
    model_id = "sgp4"

    def __init__(self, tle_line1: str, tle_line2: str):
        self.sat = Satrec.twoline2rv(tle_line1, tle_line2)

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(datetime.datetime.utcnow())

    @staticmethod
    def _utc(instant: datetime.datetime) -> datetime.datetime:
        return (
            instant.replace(tzinfo=datetime.UTC)
            if instant.tzinfo is None
            else instant.astimezone(datetime.UTC)
        )

    def _teme_state_km(
        self,
        instant: datetime.datetime,
        *,
        strict: bool,
    ) -> tuple[float, float, float, float, float, float, float, float]:
        """Evaluate the native SGP4 TEME state and its GMST angle.

        ``strict`` is reserved for analysis endpoints: a degraded SGP4 error
        code cannot produce trustworthy osculating parameters.  The legacy
        renderer path retains its historical warning-and-return behaviour.
        """

        utc = self._utc(instant)
        julian_day, julian_fraction = jday(
            utc.year,
            utc.month,
            utc.day,
            utc.hour,
            utc.minute,
            utc.second + (utc.microsecond / 1_000_000.0),
        )
        error_code, position_km, velocity_km_s = self.sat.sgp4(julian_day, julian_fraction)
        if error_code != 0:
            message = f"SGP4 propagation failed with code {error_code}"
            if strict:
                raise ValueError(message)
            print(f"SGP4 propagation warning: code {error_code}")
        return (*position_km, *velocity_km_s, julian_day, julian_fraction)

    def propagate_teme_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Return the native TEME state in kilometres and kilometres/s.

        This is deliberately separate from :meth:`propagate_datetime`, whose
        public contract is ITRF metres / metres-per-second for Cesium.
        """

        x, y, z, vx, vy, vz, _julian_day, _julian_fraction = self._teme_state_km(instant, strict=True)
        return float(x), float(y), float(z), float(vx), float(vy), float(vz)

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        x, y, z, vx, vy, vz, julian_day, julian_fraction = self._teme_state_km(instant, strict=False)

        position_m = tuple(coordinate * 1000 for coordinate in (x, y, z))
        velocity_m_s = tuple(coordinate * 1000 for coordinate in (vx, vy, vz))
        return self._teme_to_ecef(*position_m, *velocity_m_s, self._gmst_rad(julian_day, julian_fraction))

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(datetime.datetime.utcnow() + datetime.timedelta(seconds=seconds))

    @staticmethod
    def _gmst_rad(julian_day: float, julian_fraction: float) -> float:
        centuries = (julian_day + julian_fraction - 2451545.0) / 36525.0
        seconds = (
            67310.54841
            + (876600.0 * 3600.0 + 8640184.812866) * centuries
            + 0.093104 * centuries ** 2
            - 6.2e-6 * centuries ** 3
        )
        radians = math.fmod(math.radians(seconds / 240.0), 2.0 * math.pi)
        return radians + 2.0 * math.pi if radians < 0.0 else radians

    @staticmethod
    def _teme_to_ecef(x, y, z, vx, vy, vz, gmst):
        cos_gmst, sin_gmst = math.cos(gmst), math.sin(gmst)
        ecef_x = x * cos_gmst + y * sin_gmst
        ecef_y = -x * sin_gmst + y * cos_gmst
        # r_ITRF = R3(-GMST) r_TEME.  The time derivative of that rotation is
        # (+omega*y, -omega*x) in Earth-fixed coordinates.
        ecef_vx = vx * cos_gmst + vy * sin_gmst + _EARTH_ROTATION_RATE_RAD_S * ecef_y
        ecef_vy = -vx * sin_gmst + vy * cos_gmst - _EARTH_ROTATION_RATE_RAD_S * ecef_x
        return ecef_x, ecef_y, z, ecef_vx, ecef_vy, vz

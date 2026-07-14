"""SGP4 implementation that converts TEME output to Cesium-compatible ECEF."""

import datetime
import math

from sgp4.api import Satrec, jday


_EARTH_ROTATION_RATE_RAD_S = 7.2921150e-5


class SGP4Propagator:
    """Propagate a two-line element set using the SGP4 model."""

    def __init__(self, tle_line1: str, tle_line2: str):
        self.sat = Satrec.twoline2rv(tle_line1, tle_line2)

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(datetime.datetime.utcnow())

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        julian_day, julian_fraction = jday(
            instant.year, instant.month, instant.day, instant.hour, instant.minute, instant.second
        )
        error_code, position_km, velocity_km_s = self.sat.sgp4(julian_day, julian_fraction)
        if error_code != 0:
            # Preserve the legacy endpoint behaviour: callers receive the
            # SGP4 output while the backend records the degraded propagation.
            print(f"SGP4 propagation warning: code {error_code}")

        position_m = tuple(coordinate * 1000 for coordinate in position_km)
        velocity_m_s = tuple(coordinate * 1000 for coordinate in velocity_km_s)
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
        ecef_vx = vx * cos_gmst + vy * sin_gmst - _EARTH_ROTATION_RATE_RAD_S * ecef_y
        ecef_vy = -vx * sin_gmst + vy * cos_gmst + _EARTH_ROTATION_RATE_RAD_S * ecef_x
        return ecef_x, ecef_y, z, ecef_vx, ecef_vy, vz

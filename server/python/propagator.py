# propagator.py
from sgp4.api import Satrec, jday
import datetime
import math

# Earth rotation rate (rad/s) — WGS-84
_EARTH_ROTATION_RATE = 7.2921150e-5


class SGP4Propagator:

    def __init__(self, tle_line1, tle_line2):
        self.sat = Satrec.twoline2rv(tle_line1, tle_line2)

    def propagate(self):
        return self.propagate_datetime(datetime.datetime.utcnow())

    @staticmethod
    def _gmst_rad(jd, fr):
        """Greenwich Mean Sidereal Time in radians for the given Julian Date."""
        tut1 = (jd + fr - 2451545.0) / 36525.0
        gmst_sec = (
            67310.54841
            + (876600.0 * 3600.0 + 8640184.812866) * tut1
            + 0.093104 * tut1 ** 2
            - 6.2e-6 * tut1 ** 3
        )
        # 1 second of time = 1/240 degree = 1/240 * pi/180 rad
        gmst_rad = math.fmod(math.radians(gmst_sec / 240.0), 2.0 * math.pi)
        if gmst_rad < 0.0:
            gmst_rad += 2.0 * math.pi
        return gmst_rad

    @staticmethod
    def _teme_to_ecef(x, y, z, vx, vy, vz, gmst):
        """
        Rotate position and velocity from TEME (quasi-inertial) to ECEF
        (Earth-Centered Earth-Fixed, co-rotating with the planet).

        Position:
            r_ecef = R_z(GMST) @ r_teme

        Velocity (includes Coriolis correction due to Earth spin):
            v_ecef = R_z(GMST) @ v_teme  −  omega_earth × r_ecef
        """
        cos_g = math.cos(gmst)
        sin_g = math.sin(gmst)

        # Rotate position
        px = x * cos_g + y * sin_g
        py = -x * sin_g + y * cos_g
        pz = z

        # Rotate velocity and subtract Earth-spin correction
        wx = vx * cos_g + vy * sin_g - _EARTH_ROTATION_RATE * py
        wy = -vx * sin_g + vy * cos_g + _EARTH_ROTATION_RATE * px
        wz = vz

        return px, py, pz, wx, wy, wz

    def propagate_datetime(self, dt):
        jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)

        e, r, v = self.sat.sgp4(jd, fr)

        if e != 0:
            print("Error SGP4:", e)

        # SGP4 returns km → convert to metres
        x, y, z = [coord * 1000 for coord in r]
        vx, vy, vz = [coord * 1000 for coord in v]

        # Convert TEME → ECEF so Cesium (which works in ECEF) shows correct
        # ground tracks that drift westward as the Earth rotates.
        gmst = self._gmst_rad(jd, fr)
        return self._teme_to_ecef(x, y, z, vx, vy, vz, gmst)

    def propagate_offset(self, seconds):
        target_time = datetime.datetime.utcnow() + datetime.timedelta(seconds=seconds)
        return self.propagate_datetime(target_time)

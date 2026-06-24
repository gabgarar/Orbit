# propagator.py
from sgp4.api import Satrec, jday
import datetime

class SGP4Propagator:

    def __init__(self, tle_line1, tle_line2):
        self.sat = Satrec.twoline2rv(tle_line1, tle_line2)

    def propagate(self):
        return self.propagate_datetime(datetime.datetime.utcnow())

    def propagate_datetime(self, dt):
        jd, fr = jday(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second)

        e, r, v = self.sat.sgp4(jd, fr)

        if e != 0:
            print("Error SGP4:", e)

        x, y, z = [coord * 1000 for coord in r]
        vx, vy, vz = [coord * 1000 for coord in v]
        return x, y, z, vx, vy, vz

    def propagate_offset(self, seconds):
        target_time = datetime.datetime.utcnow() + datetime.timedelta(seconds=seconds)
        return self.propagate_datetime(target_time)

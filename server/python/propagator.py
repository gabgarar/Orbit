# propagator.py
from sgp4.api import Satrec, jday
import datetime

class SGP4Propagator:

    def __init__(self, tle_line1, tle_line2):
        self.sat = Satrec.twoline2rv(tle_line1, tle_line2)

    def propagate(self):
        now = datetime.datetime.utcnow()
        jd, fr = jday(now.year, now.month, now.day, now.hour, now.minute, now.second)

        e, r, v = self.sat.sgp4(jd, fr)

        if e != 0:
            print("Error SGP4:", e)

        x, y, z = [coord * 1000 for coord in r]
        return x, y, z

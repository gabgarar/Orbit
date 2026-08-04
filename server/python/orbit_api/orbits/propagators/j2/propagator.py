"""Analytical first-order secular J2 propagation for manual ECI orbits."""

from __future__ import annotations

import datetime
import math
from collections.abc import Mapping

from orbit_api.frames import FrameTransformService

from ..classical import (
    EARTH_EQUATORIAL_RADIUS_KM,
    ClassicalElements,
    state_eci_from_mean_elements,
)
from ..two_body import TwoBodyPropagator
from orbit_api.timekeeping import ensure_utc


EARTH_J2 = 1.08262668e-3


class J2Propagator(TwoBodyPropagator):
    """Two-body propagation with secular oblateness precession.

    This is deliberately a first-order analytical J2 model: semi-major axis,
    eccentricity, and inclination remain constant while RAAN, argument of
    perigee, and mean anomaly receive their standard secular rates.  It does
    not model atmospheric drag, so it cannot lose orbital energy or decay.
    """

    model_id = "j2"

    def __init__(
        self,
        epoch: datetime.datetime,
        keplerian: Mapping[str, object],
        *,
        frame_transformer: FrameTransformService | None = None,
    ):
        super().__init__(epoch, keplerian, frame_transformer=frame_transformer)
        elements = self.elements
        p = elements.semi_latus_rectum_km
        n = elements.mean_motion_rad_s
        cosine_inclination = math.cos(elements.inclination_rad)
        common = EARTH_J2 * n * ((EARTH_EQUATORIAL_RADIUS_KM / p) ** 2)
        self.raan_rate_rad_s = -1.5 * common * cosine_inclination
        self.argument_of_perigee_rate_rad_s = 0.75 * common * ((5.0 * (cosine_inclination ** 2)) - 1.0)
        self.mean_anomaly_rate_rad_s = n + (
            0.75
            * common
            * ((1.0 - (elements.eccentricity ** 2)) ** 0.5)
            * ((3.0 * (cosine_inclination ** 2)) - 1.0)
        )

    def elements_at(self, instant: datetime.datetime) -> ClassicalElements:
        elapsed_seconds = (ensure_utc(instant) - self.epoch).total_seconds()
        return self.elements.advanced(
            elapsed_seconds,
            raan_rate_rad_s=self.raan_rate_rad_s,
            argument_of_perigee_rate_rad_s=self.argument_of_perigee_rate_rad_s,
            mean_anomaly_rate_rad_s=self.mean_anomaly_rate_rad_s,
        )

    def propagate_eme2000_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Return an EME2000 state whose velocity matches the secular position.

        ``state_eci_from_mean_elements`` returns the two-body derivative for
        its instantaneous anomaly.  J2 also rotates the orbital plane and
        apsides, so its full derivative additionally contains the RAAN and
        argument-of-perigee angular-velocity terms.  Applying them here keeps
        telemetry, orientation, OEM output, and ITRF velocity consistent with
        the precessing geometry rendered by this engine.
        """

        elements = self.elements_at(instant)
        x, y, z, kepler_vx, kepler_vy, kepler_vz = state_eci_from_mean_elements(elements)
        mean_scale = self.mean_anomaly_rate_rad_s / elements.mean_motion_rad_s
        # Unit orbital angular-momentum direction in the current EME2000 frame.
        sin_i, cos_i = math.sin(elements.inclination_rad), math.cos(elements.inclination_rad)
        sin_raan, cos_raan = math.sin(elements.raan_rad), math.cos(elements.raan_rad)
        h_x, h_y, h_z = sin_raan * sin_i, -cos_raan * sin_i, cos_i
        # d/dOmega = k-hat x r; d/domega = h-hat x r.
        raan_vx, raan_vy, raan_vz = -y, x, 0.0
        argument_vx = (h_y * z) - (h_z * y)
        argument_vy = (h_z * x) - (h_x * z)
        argument_vz = (h_x * y) - (h_y * x)
        return (
            x,
            y,
            z,
            (mean_scale * kepler_vx)
            + (self.raan_rate_rad_s * raan_vx)
            + (self.argument_of_perigee_rate_rad_s * argument_vx),
            (mean_scale * kepler_vy)
            + (self.raan_rate_rad_s * raan_vy)
            + (self.argument_of_perigee_rate_rad_s * argument_vy),
            (mean_scale * kepler_vz)
            + (self.raan_rate_rad_s * raan_vz)
            + (self.argument_of_perigee_rate_rad_s * argument_vz),
        )

    def propagate_eci_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Legacy alias for the explicitly named EME2000 native state."""

        return self.propagate_eme2000_datetime(instant)

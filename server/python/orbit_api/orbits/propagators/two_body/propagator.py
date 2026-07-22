"""Two-body propagation from manual ECI mean elements."""

from __future__ import annotations

import datetime
from collections.abc import Mapping

from ..classical import ClassicalElements, eci_to_itrf, ensure_utc, state_eci_from_mean_elements


class TwoBodyPropagator:
    """Propagate a bounded manual orbit with ideal Keplerian dynamics.

    The model evolves classical mean elements in ECI and only converts to ITRF
    at the adapter boundary.  This preserves the renderer's existing metres /
    metres-per-second contract while keeping the physical model independent of
    Earth rotation.
    """

    dynamics_reference_frame = "ECI"
    ephemeris_reference_frame = "ITRF"
    model_id = "two-body"

    def __init__(self, epoch: datetime.datetime, keplerian: Mapping[str, object]):
        self.epoch = ensure_utc(epoch)
        self.elements = ClassicalElements.from_mapping(keplerian)
        self.semi_major_axis_km = self.elements.semi_major_axis_km
        self.eccentricity = self.elements.eccentricity
        self.orbital_period_seconds = self.elements.orbital_period_seconds

    def elements_at(self, instant: datetime.datetime) -> ClassicalElements:
        utc = ensure_utc(instant)
        elapsed_seconds = (utc - self.epoch).total_seconds()
        return self.elements.advanced(elapsed_seconds)

    def propagate_eci_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Return the propagated ECI state in kilometres and kilometres/s."""

        return state_eci_from_mean_elements(self.elements_at(instant))

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Return the propagated ITRF state in metres and metres/s."""

        utc = ensure_utc(instant)
        return eci_to_itrf(*self.propagate_eci_datetime(utc), utc)

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(datetime.datetime.now(datetime.UTC))

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(datetime.datetime.now(datetime.UTC) + datetime.timedelta(seconds=float(seconds)))

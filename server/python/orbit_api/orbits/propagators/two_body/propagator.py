"""Two-body propagation in an explicit EME2000 native frame."""

from __future__ import annotations

import datetime
from collections.abc import Mapping

from orbit_api.frames import FrameId, FrameTransformService, StateVector
from orbit_api.timekeeping import ensure_utc, utc_now

from ..classical import ClassicalElements, state_eci_from_mean_elements


class TwoBodyPropagator:
    """Propagate a bounded manual orbit with ideal Keplerian dynamics.

    Historical manual inputs called this generic ``ECI``. Orbit now documents
    the compatibility assumption as EME2000, while preserving the old tuple
    method as an adapter for existing editor code.
    """

    dynamics_reference_frame = FrameId.EME2000.value
    dynamics_reference_realization = None
    ephemeris_reference_frame = FrameId.ITRF.value
    ephemeris_reference_realization = None
    model_id = "two-body"

    def __init__(
        self,
        epoch: datetime.datetime,
        keplerian: Mapping[str, object],
        *,
        frame_transformer: FrameTransformService | None = None,
    ) -> None:
        self.epoch = ensure_utc(epoch)
        self.elements = ClassicalElements.from_mapping(keplerian)
        self.semi_major_axis_km = self.elements.semi_major_axis_km
        self.eccentricity = self.elements.eccentricity
        self.orbital_period_seconds = self.elements.orbital_period_seconds
        self._frame_transformer = frame_transformer or FrameTransformService()

    @property
    def frame_transformer(self) -> FrameTransformService:
        return self._frame_transformer

    def elements_at(self, instant: datetime.datetime) -> ClassicalElements:
        utc = ensure_utc(instant)
        elapsed_seconds = (utc - self.epoch).total_seconds()
        return self.elements.advanced(elapsed_seconds)

    def propagate_eme2000_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Return the native EME2000 state in kilometres and kilometres/s."""

        return state_eci_from_mean_elements(self.elements_at(instant))

    def propagate_eci_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Legacy alias for :meth:`propagate_eme2000_datetime`.

        New callers must use the explicit EME2000 name; generic ECI is not a
        valid frame identifier in the common state contract.
        """

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

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        """Legacy renderer adapter returning ITRF SI components."""

        return self.state_at(instant, target_frame=FrameId.ITRF).components()

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now())

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]:
        return self.propagate_datetime(utc_now() + datetime.timedelta(seconds=float(seconds)))

"""Higher-order zonal-gravity manual propagator."""

from __future__ import annotations

import datetime
from collections.abc import Mapping

from ..cowell import CowellPropagator


class J2J3J4Propagator:
    """Fixed WGS-84 J2/J3/J4 zonal-gravity manual propagator.

    This is a named *force-model preset*, distinct from the configurable
    ``cowell-rk4`` propagator. The current numerical implementation delegates
    its integration kernel to the shared RK4 solver, but its public identity,
    force model, and supported options remain fixed: it never accepts
    atmospheric drag. Keeping this as composition rather than inheritance
    prevents callers from accidentally treating the preset as Cowell.
    """

    model_id = "j2-j3-j4"
    dynamics_reference_frame = "ECI"
    ephemeris_reference_frame = "ITRF"
    numerical_integrator = "Fixed-step RK4"
    integration_step_seconds = CowellPropagator.integration_step_seconds

    def __init__(
        self,
        epoch: datetime.datetime,
        state_vector: Mapping[str, object],
        *,
        atmospheric_drag: bool = False,
    ) -> None:
        if atmospheric_drag:
            raise ValueError(
                "J2 + J3 + J4 is a fixed zonal-gravity model and does not support atmospheric drag; "
                "use cowell-rk4 instead"
            )
        self.gravity_model = "j2-j3-j4"
        self.force_model_id = "j2-j3-j4"
        self.atmospheric_drag = False
        self._integrator = CowellPropagator(
            epoch,
            state_vector,
            gravity_model="j2-j3-j4",
            atmospheric_drag=False,
        )
        self.epoch = self._integrator.epoch

    @property
    def applied_engine(self) -> str:
        return "j2-j3-j4"

    def propagate_eci_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        return self._integrator.propagate_eci_datetime(instant)

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]:
        return self._integrator.propagate_datetime(instant)

    def propagate(self) -> tuple[float, float, float, float, float, float]:
        return self._integrator.propagate()

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]:
        return self._integrator.propagate_offset(seconds)

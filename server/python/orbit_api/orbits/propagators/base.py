"""Common propagation contract: native state first, target frame second."""

from __future__ import annotations

import datetime
from typing import Protocol

from orbit_api.frames import FrameId, StateVector


class OrbitPropagator(Protocol):
    """Provide a declared native state and explicit transformed views.

    The tuple-returning methods remain below as legacy renderer adapters. New
    application code should call ``native_state_at`` or ``state_at`` so a TEME
    TLE, a manual EME2000 model, an SP3 sample and an OEM segment share one
    frame/time contract.
    """

    dynamics_reference_frame: str
    ephemeris_reference_frame: str

    def native_state_at(self, instant: datetime.datetime) -> StateVector: ...

    def state_at(
        self,
        instant: datetime.datetime,
        *,
        target_frame: FrameId | str = FrameId.ITRF,
        target_realization: str | None = None,
    ) -> StateVector: ...

    def propagate(self) -> tuple[float, float, float, float, float, float]: ...

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]: ...

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]: ...

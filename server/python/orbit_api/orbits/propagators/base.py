"""Common contract implemented by every orbit propagation engine."""

import datetime
from typing import Protocol


class OrbitPropagator(Protocol):
    """Provide ECEF position and velocity in metres and metres per second."""

    def propagate(self) -> tuple[float, float, float, float, float, float]: ...

    def propagate_datetime(self, instant: datetime.datetime) -> tuple[float, float, float, float, float, float]: ...

    def propagate_offset(self, seconds: float) -> tuple[float, float, float, float, float, float]: ...

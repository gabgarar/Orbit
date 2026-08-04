"""Registry and factory for selecting installed orbit propagation engines."""

from collections.abc import Callable

from orbit_api.frames import FrameTransformService

from .base import OrbitPropagator


PropagatorFactory = Callable[[str, str], OrbitPropagator]


class PropagatorRegistry:
    """Register named engines without coupling API routes to implementations."""

    def __init__(self):
        self._factories: dict[str, PropagatorFactory] = {}

    def register(self, name: str, factory: PropagatorFactory) -> None:
        key = self._normalise_name(name)
        if not key:
            raise ValueError("A propagator name is required")
        self._factories[key] = factory

    def create(self, name: str, line1: str, line2: str) -> OrbitPropagator:
        key = self._normalise_name(name)
        factory = self._factories.get(key)
        if factory is None:
            available = ", ".join(sorted(self._factories)) or "none"
            raise ValueError(f"Unsupported propagator '{name}'. Available: {available}")
        return factory(line1, line2)

    def available(self) -> tuple[str, ...]:
        return tuple(sorted(self._factories))

    @staticmethod
    def _normalise_name(name: str) -> str:
        return str(name or "").strip().lower()


def build_default_registry(
    frame_transformer: FrameTransformService | None = None,
) -> PropagatorRegistry:
    """Create the default engine registry used by the Orbit application."""
    from .sgp4 import SGP4Propagator

    registry = PropagatorRegistry()
    registry.register(
        "sgp4",
        lambda line1, line2: SGP4Propagator(
            line1,
            line2,
            frame_transformer=frame_transformer,
        ),
    )
    return registry

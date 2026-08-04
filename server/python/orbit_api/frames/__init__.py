"""Frame-aware Cartesian state and IERS-backed transformation services."""

from orbit_api.timekeeping import EarthOrientation, TimeScale

from .configuration import build_frame_transformer_from_environment
from .model import FrameId, StateVector
from .realizations import (
    IGS20_ITRF2020_OPERATION,
    IGS20_ITRF2020_SOURCE,
    IGS20_ITRF2020_SOURCE_URL,
    register_igs20_itrf2020_identity,
)
from .transforms import FrameTransformationError, FrameTransformService

__all__ = [
    "EarthOrientation",
    "build_frame_transformer_from_environment",
    "FrameId",
    "FrameTransformationError",
    "FrameTransformService",
    "IGS20_ITRF2020_OPERATION",
    "IGS20_ITRF2020_SOURCE",
    "IGS20_ITRF2020_SOURCE_URL",
    "register_igs20_itrf2020_identity",
    "StateVector",
    "TimeScale",
]

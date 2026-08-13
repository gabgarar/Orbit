"""Composable, provenance-aware force models for Cowell propagation.

The package deliberately separates a force's physical equation from the
time/frame context in which it is evaluated.  In particular, Earth-fixed
models such as a degree-and-order geopotential must never treat EME2000 axes
as ITRF axes merely because both are Earth-centred.
"""

from .configuration import build_gravity_field_from_environment
from .context import ForceEvaluationContext, ForceEvaluationError
from .geopotential import (
    GeopotentialConfiguration,
    GravityFieldError,
    GravityFieldModel,
)

__all__ = [
    "build_gravity_field_from_environment",
    "ForceEvaluationContext",
    "ForceEvaluationError",
    "GeopotentialConfiguration",
    "GravityFieldError",
    "GravityFieldModel",
]

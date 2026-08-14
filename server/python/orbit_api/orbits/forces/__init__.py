"""Composable, provenance-aware force models for Cowell propagation.

The package deliberately separates a force's physical equation from the
time/frame context in which it is evaluated.  In particular, Earth-fixed
models such as a degree-and-order geopotential must never treat EME2000 axes
as ITRF axes merely because both are Earth-centred.
"""

from .configuration import (
    LOCAL_ICGEM_MODEL_ID,
    build_gravity_field_from_environment,
    local_icgem_model_payload,
    resolve_gravity_model_selection_from_environment,
)
from .context import ForceEvaluationContext, ForceEvaluationError
from .geopotential import (
    GeopotentialConfiguration,
    GravityFieldError,
    GravityFieldModel,
)
from .gravity_registry import (
    EGM96_SPEC,
    EGM2008_SPEC,
    GravityModelCacheError,
    GravityModelRecord,
    GravityModelRegistry,
    GravityModelSelection,
    GravityModelSpec,
    build_gravity_model_registry_from_environment,
)

__all__ = [
    "build_gravity_field_from_environment",
    "LOCAL_ICGEM_MODEL_ID",
    "local_icgem_model_payload",
    "resolve_gravity_model_selection_from_environment",
    "ForceEvaluationContext",
    "ForceEvaluationError",
    "GeopotentialConfiguration",
    "GravityFieldError",
    "GravityFieldModel",
    "EGM96_SPEC",
    "EGM2008_SPEC",
    "GravityModelCacheError",
    "GravityModelRecord",
    "GravityModelRegistry",
    "GravityModelSelection",
    "GravityModelSpec",
    "build_gravity_model_registry_from_environment",
]

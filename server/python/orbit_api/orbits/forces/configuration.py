"""Configuration boundary for local, versioned force-model data.

Gravity coefficients are science inputs, not browser preferences.  Orbit loads
an optional ICGEM field once at process start from a local file, verifies its
digest before parsing it and then passes the immutable model to every manual
Cowell request.  The absence of a configured field is explicit: legacy zonal
terms remain available, while the configurable ``geopotential`` term fails
closed rather than silently substituting a different gravity model.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from .geopotential import GravityFieldError, GravityFieldModel, load_icgem_gfc
from .gravity_registry import GravityModelRegistry, GravityModelSelection
from .limits import (
    MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
    MAX_SUPPORTED_GRAVITY_FIELD_DEGREE,
)


LOCAL_ICGEM_MODEL_ID = "LOCAL_ICGEM"


def _present(values: Mapping[str, str], key: str) -> str | None:
    value = str(values.get(key, "")).strip()
    return value or None


def build_gravity_field_from_environment(
    environment: Mapping[str, str] | None = None,
) -> GravityFieldModel | None:
    """Load one pinned ICGEM model from local configuration, if configured.

    Environment keys are deliberately narrow and file-only:

    ``ORBIT_GRAVITY_FIELD_PATH``
        Local ``.gfc`` model below the deployment's controlled configuration
        directory.
    ``ORBIT_GRAVITY_FIELD_SHA256``
        Required whenever a field path is supplied.  The file is never used
        before this digest is verified.
    ``ORBIT_GRAVITY_FIELD_SOURCE`` / ``ORBIT_GRAVITY_FIELD_VERSION``
        Optional provenance overrides.  ICGEM's ``modelname`` remains the
        fallback version when no override is specified.

    No path means no configured full field; this is valid for installations
    that use only the legacy central/J2/J3/J4 compatibility terms.
    """

    values = os.environ if environment is None else environment
    path = _present(values, "ORBIT_GRAVITY_FIELD_PATH")
    expected_sha256 = _present(values, "ORBIT_GRAVITY_FIELD_SHA256")
    source = _present(values, "ORBIT_GRAVITY_FIELD_SOURCE")
    version = _present(values, "ORBIT_GRAVITY_FIELD_VERSION")
    configured_without_path = {
        key: value
        for key, value in (
            ("ORBIT_GRAVITY_FIELD_SHA256", expected_sha256),
            ("ORBIT_GRAVITY_FIELD_SOURCE", source),
            ("ORBIT_GRAVITY_FIELD_VERSION", version),
        )
        if value is not None
    }
    if path is None:
        if configured_without_path:
            names = ", ".join(sorted(configured_without_path))
            raise GravityFieldError(
                f"{names} requiere ORBIT_GRAVITY_FIELD_PATH"
            )
        return None
    if expected_sha256 is None:
        raise GravityFieldError(
            "ORBIT_GRAVITY_FIELD_SHA256 es obligatorio cuando se configura "
            "ORBIT_GRAVITY_FIELD_PATH"
        )
    return load_icgem_gfc(
        path,
        expected_sha256=expected_sha256,
        source=source,
        version=version,
    )


def resolve_gravity_model_selection_from_environment(
    registry: GravityModelRegistry,
    environment: Mapping[str, str] | None = None,
    *,
    model_id: str | None = None,
    degree: int | None = None,
    order: int | None = None,
) -> GravityModelSelection:
    """Resolve an NGA selection without downloading or evaluating a force.

    This is the bridge for propagation/settings adapters.  It deliberately
    coexists with ``build_gravity_field_from_environment``: an explicitly
    mounted, checksum-pinned ICGEM file remains the reproducible legacy
    configuration and takes precedence wherever an adapter chooses it.

    When explicit arguments are omitted, the helper reads the optional global
    ``ORBIT_GRAVITY_MODEL``, ``ORBIT_GRAVITY_DEGREE`` and
    ``ORBIT_GRAVITY_ORDER`` values.  The registry performs the model-specific
    clamp and returns provenance/warnings; it never performs network I/O.
    """

    if not isinstance(registry, GravityModelRegistry):
        raise TypeError("registry debe ser GravityModelRegistry")
    values = os.environ if environment is None else environment
    selected = model_id if model_id is not None else _present(values, "ORBIT_GRAVITY_MODEL")
    requested_degree: int | str | None = degree
    requested_order: int | str | None = order
    if requested_degree is None:
        requested_degree = _present(values, "ORBIT_GRAVITY_DEGREE")
    if requested_order is None:
        requested_order = _present(values, "ORBIT_GRAVITY_ORDER")
    return registry.resolve_selection(selected, requested_degree, requested_order)


def local_icgem_model_payload(field: GravityFieldModel | None) -> dict[str, object] | None:
    """Describe the explicit checksum-pinned ICGEM field for API clients.

    The local ICGEM parser has already validated complete triangular ``gfc``
    coverage before it can create this field. Missing rows are therefore an
    error, never an implicit zero. Its declared degree is a real evaluator
    limit; the manual request envelope still has a separate hard degree
    ceiling.
    """

    if field is None:
        return None
    maximum = min(int(field.max_degree), MAX_SUPPORTED_GRAVITY_FIELD_DEGREE)
    coverage = (
        [
            {
                "startDegree": 2,
                "endDegree": maximum,
                "maxOrder": "degree",
                "orderRule": "degree",
            }
        ]
        if maximum >= 2
        else []
    )
    return {
        "id": LOCAL_ICGEM_MODEL_ID,
        "label": "ICGEM local fijado",
        "status": "ok",
        "loaded": True,
        "available": True,
        "source": "local-icgem",
        "sourceDetail": field.source,
        "version": field.version,
        "sha256": field.sha256,
        "maxDegree": maximum,
        "maxOrder": maximum,
        "coefficientMaxDegree": maximum,
        "coefficientMaxOrder": maximum,
        "completeThroughDegree": maximum,
        "tailMaxOrder": maximum,
        "degreeCoverage": coverage,
        "coverage": {
            "firstDegree": 2 if maximum >= 2 else None,
            "maxDegree": maximum,
            "maxOrder": maximum,
            "completeThroughDegree": maximum,
            "tailMaxOrder": maximum,
            "degreeCoverage": coverage,
        },
        "validation": "complete triangular ICGEM gfc coverage validated",
        "executionLimit": {
            "maxHarmonicTerms": MAX_PURE_PYTHON_RK4_GEOPOTENTIAL_TERMS,
        },
        "normalization": field.normalization,
        "tideSystem": field.tide_system,
        "hardMaxDegree": MAX_SUPPORTED_GRAVITY_FIELD_DEGREE,
        "hardMaxOrder": MAX_SUPPORTED_GRAVITY_FIELD_DEGREE,
        "automatic": False,
        "refreshDue": False,
        "usingCachedFallback": False,
    }


__all__ = [
    "LOCAL_ICGEM_MODEL_ID",
    "build_gravity_field_from_environment",
    "local_icgem_model_payload",
    "resolve_gravity_model_selection_from_environment",
]

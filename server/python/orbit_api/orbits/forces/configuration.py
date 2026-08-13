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


__all__ = ["build_gravity_field_from_environment"]

"""Explicit runtime wiring for local, versioned Earth-orientation data.

Coordinate code must never fetch a changing EOP product while transforming a
state.  This small composition helper lets a deployment mount a pinned IERS
C04 snapshot and records its source/version through :class:`FrameTransformService`.
Without that configuration the interactive visual fallback remains available
and is marked ``approximate`` in every transformed state.
"""

from __future__ import annotations

import os
import datetime
from collections.abc import Mapping
from pathlib import Path

from orbit_api.timekeeping import (
    IersC04EarthOrientationProvider,
    LeapSecondTable,
    configure_default_leap_second_table,
    ensure_utc,
    load_leap_second_table_from_environment,
)

from .realizations import register_igs20_itrf2020_identity
from .transforms import FrameTransformService


def _enabled(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _required_utc(values: Mapping[str, str], name: str) -> datetime.datetime | None:
    raw = str(values.get(name, "")).strip()
    if not raw:
        return None
    try:
        return ensure_utc(datetime.datetime.fromisoformat(raw.replace("Z", "+00:00")))
    except ValueError as exc:
        raise ValueError(f"{name} debe ser una fecha ISO-8601 con zona horaria") from exc


def _validate_required_coverage(
    provider: IersC04EarthOrientationProvider,
    values: Mapping[str, str],
) -> None:
    required_start = _required_utc(values, "ORBIT_EOP_REQUIRED_START")
    required_end = _required_utc(values, "ORBIT_EOP_REQUIRED_END")
    if required_start is None and required_end is None:
        return
    if required_start is not None and required_end is not None and required_end < required_start:
        raise ValueError("ORBIT_EOP_REQUIRED_END no puede ser anterior a ORBIT_EOP_REQUIRED_START")
    snapshot = provider.snapshot_identity
    if snapshot is None:  # Defensive: configured provider always loads from a file.
        raise ValueError("No se pudo determinar la cobertura del snapshot EOP local")
    if required_start is not None and required_start < snapshot.coverage_start:
        raise ValueError(
            "El snapshot EOP no cubre ORBIT_EOP_REQUIRED_START "
            f"({snapshot.coverage_start.isoformat()} es el inicio disponible)"
        )
    if required_end is not None and required_end > snapshot.coverage_end:
        raise ValueError(
            "El snapshot EOP no cubre ORBIT_EOP_REQUIRED_END "
            f"({snapshot.coverage_end.isoformat()} es el final disponible)"
        )


def _validate_required_leap_second_coverage(
    leap_seconds: LeapSecondTable,
    values: Mapping[str, str],
    *,
    require_unexpired: bool,
) -> None:
    """Validate the same declared operational window against UTC→TAI data."""

    required_start = _required_utc(values, "ORBIT_EOP_REQUIRED_START")
    required_end = _required_utc(values, "ORBIT_EOP_REQUIRED_END")
    for label, instant in (
        ("ORBIT_EOP_REQUIRED_START", required_start),
        ("ORBIT_EOP_REQUIRED_END", required_end),
    ):
        if instant is not None:
            leap_seconds.require_coverage(instant, require_unexpired=require_unexpired)


def build_frame_transformer_from_environment(
    environment: Mapping[str, str] | None = None,
) -> FrameTransformService:
    """Build the shared transformer from opt-in local EOP configuration.

    Supported values are deliberately narrow and filesystem-only:

    ``ORBIT_EOP_C04_PATH``
        Local IERS C04-compatible table. Its coverage is strict unless
        ``ORBIT_EOP_ALLOW_EXTRAPOLATION`` is enabled.
    ``ORBIT_EOP_C04_SHA256``
        Expected SHA-256 of that exact local file. Set
        ``ORBIT_EOP_C04_REQUIRE_SHA256=true`` (or ``ORBIT_EOP_STRICT=true``)
        to fail startup when it is absent or mismatched.
    ``ORBIT_EOP_SOURCE``, ``ORBIT_EOP_VERSION``, ``ORBIT_EOP_QUALITY``
        Provenance written into transformed states; ``VERSION`` defaults to
        the snapshot file name.
    ``ORBIT_EOP_STRICT``
        Reject approximate/extrapolated EOP rather than merely labelling it.
    ``ORBIT_TERRESTRIAL_REALIZATION``
        An explicitly controlled output realization. It is intentionally not
        assumed from an EOP table.
    ``ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT``
        Opt in to the published zero-parameter global datum operation for
        *satellite orbit states* declared as IGS20. It requires
        ``ORBIT_TERRESTRIAL_REALIZATION=ITRF2020`` and never applies
        station/antenna corrections. Newer IGS realizations remain explicit
        until their own published operation is registered.
    ``ORBIT_EOP_REQUIRED_START``, ``ORBIT_EOP_REQUIRED_END``
        Optional ISO-8601 bounds that must be covered by the mounted snapshot
        at startup. They prevent a deployment from starting with stale data
        for a known simulation/export window.
    """

    values = os.environ if environment is None else environment
    snapshot = str(values.get("ORBIT_EOP_C04_PATH", "")).strip()
    strict_eop = _enabled(values.get("ORBIT_EOP_STRICT"))
    allow_extrapolation = _enabled(values.get("ORBIT_EOP_ALLOW_EXTRAPOLATION"))
    expected_sha256 = str(values.get("ORBIT_EOP_C04_SHA256", "")).strip() or None
    require_sha256 = strict_eop or _enabled(values.get("ORBIT_EOP_C04_REQUIRE_SHA256"))
    realization = str(values.get("ORBIT_TERRESTRIAL_REALIZATION", "")).strip() or None
    quality = str(values.get("ORBIT_EOP_QUALITY", "final")).strip().lower() or "final"
    enable_igs20_itrf2020 = _enabled(values.get("ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT"))
    if enable_igs20_itrf2020 and (realization or "").upper() != "ITRF2020":
        raise ValueError(
            "ORBIT_ENABLE_IGS20_ITRF2020_ALIGNMENT requiere "
            "ORBIT_TERRESTRIAL_REALIZATION=ITRF2020"
        )
    eop_provider: IersC04EarthOrientationProvider | None
    if not snapshot:
        if strict_eop:
            raise ValueError("ORBIT_EOP_C04_PATH es obligatorio cuando ORBIT_EOP_STRICT=true")
        if require_sha256 or expected_sha256 is not None:
            raise ValueError(
                "ORBIT_EOP_C04_PATH es obligatorio cuando se exige o se suministra "
                "ORBIT_EOP_C04_SHA256"
            )
        if _required_utc(values, "ORBIT_EOP_REQUIRED_START") is not None or _required_utc(values, "ORBIT_EOP_REQUIRED_END") is not None:
            raise ValueError("Los límites ORBIT_EOP_REQUIRED_* requieren ORBIT_EOP_C04_PATH")
        eop_provider = None
    else:
        if strict_eop and allow_extrapolation:
            raise ValueError("ORBIT_EOP_STRICT=true no admite ORBIT_EOP_ALLOW_EXTRAPOLATION=true")
        if strict_eop and quality not in {"final", "rapid"}:
            raise ValueError("ORBIT_EOP_STRICT=true requiere ORBIT_EOP_QUALITY=final o rapid")
        if require_sha256 and expected_sha256 is None:
            raise ValueError("ORBIT_EOP_C04_SHA256 es obligatorio para esta política EOP")

        path = Path(snapshot).expanduser()
        eop_provider = IersC04EarthOrientationProvider.from_file(
            path,
            source=str(values.get("ORBIT_EOP_SOURCE", "IERS EOP C04")).strip() or "IERS EOP C04",
            version=str(values.get("ORBIT_EOP_VERSION", "")).strip() or path.name,
            quality=quality,
            allow_extrapolation=allow_extrapolation,
            expected_sha256=expected_sha256,
        )
        _validate_required_coverage(eop_provider, values)
    leap_seconds = load_leap_second_table_from_environment(values)
    _validate_required_leap_second_coverage(
        leap_seconds,
        values,
        require_unexpired=strict_eop or _enabled(values.get("ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED")),
    )
    service = FrameTransformService(
        eop_provider,
        default_terrestrial_realization=realization,
        strict_eop=strict_eop,
        leap_second_table=leap_seconds,
    )
    if enable_igs20_itrf2020:
        register_igs20_itrf2020_identity(service)
    # Time-scale configuration belongs to its own module, but the public
    # frame factory is the composition boundary: direct library callers and
    # FastAPI therefore use the same pinned UTC→TT table. It runs only after
    # C04/realization validation succeeds, avoiding a partial startup change.
    configure_default_leap_second_table(leap_seconds)
    return service

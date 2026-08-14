"""Opt-in integration and timing evidence over a pinned public SP3/ERP pair.

This module is deliberately skipped unless ``ORBIT_RUN_REAL_DATA=1``.  It
never downloads merely because pytest collected it: setting
``ORBIT_DOWNLOAD_REAL_DATA=1`` is the separate, explicit permission for a
cache miss to use the fixed HTTPS source.  Regular local tests and GitHub CI
therefore remain deterministic and offline.
"""

from __future__ import annotations

import base64
import gzip
import math
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from orbit_api.application.precise_products import import_precise_product
from orbit_api.formats import Sp3StateProvider
from orbit_api.timekeeping import IgsErpEarthOrientationProvider
from tests_support.real_data import (
    CODE_MGEX_ERP,
    CODE_MGEX_SP3,
    REAL_DATA_CAPABILITIES,
    RealDataCache,
    ValidatedDataset,
    is_real_data_download_enabled,
    is_real_data_enabled,
    is_real_data_performance_enabled,
    resolve_precise_product_bundle,
)

pytestmark = [
    pytest.mark.realdata,
    pytest.mark.skipif(
        not is_real_data_enabled(),
        reason=(
            "Datos reales desactivados; use ORBIT_RUN_REAL_DATA=1 o "
            ".\\.scripts\\test-real-data.ps1. Esta suite nunca abre red por defecto."
        ),
    ),
]


@dataclass(frozen=True, slots=True)
class _RealProduct:
    files: dict[str, ValidatedDataset]
    sp3: Sp3StateProvider
    erp: IgsErpEarthOrientationProvider
    satellite_id: str


@pytest.fixture(scope="session")
def real_product() -> Iterator[_RealProduct]:
    """Resolve local/cache data only after the user chose the opt-in suite."""

    files = resolve_precise_product_bundle(
        cache=RealDataCache(),
        download=is_real_data_download_enabled(),
    )
    with gzip.open(files[CODE_MGEX_SP3.identifier].path, "rb") as sp3_handle:
        sp3_bytes = sp3_handle.read()
    with gzip.open(files[CODE_MGEX_ERP.identifier].path, "rb") as erp_handle:
        erp_bytes = erp_handle.read()
    sp3 = Sp3StateProvider.from_text(sp3_bytes.decode("ascii"), strict_structure=True)
    erp = IgsErpEarthOrientationProvider.from_text(
        erp_bytes.decode("utf-8"),
        filename=files[CODE_MGEX_ERP.identifier].path.name,
    )
    satellite_id = "G01" if "G01" in sp3.satellite_ids else sp3.satellite_ids[0]
    yield _RealProduct(files=files, sp3=sp3, erp=erp, satellite_id=satellite_id)


def _performance_budget(default_seconds: float) -> float:
    """Read a deliberate operator override without hiding a bad value."""

    configured = os.environ.get("ORBIT_REAL_DATA_PERF_MAX_SECONDS", "").strip()
    if not configured:
        return default_seconds
    try:
        value = float(configured)
    except ValueError as exc:
        raise AssertionError("ORBIT_REAL_DATA_PERF_MAX_SECONDS debe ser numérico") from exc
    if not math.isfinite(value) or value <= 0.0:
        raise AssertionError("ORBIT_REAL_DATA_PERF_MAX_SECONDS debe ser positivo y finito")
    return value


def test_pinned_code_mgex_sp3_and_erp_are_strictly_parsed_with_overlapping_coverage(real_product: _RealProduct):
    """Validate native SP3, paired ERP and bounded interpolation over real bytes."""

    assert real_product.files[CODE_MGEX_SP3.identifier].sha256 == CODE_MGEX_SP3.expected_sha256
    assert real_product.files[CODE_MGEX_ERP.identifier].sha256 == CODE_MGEX_ERP.expected_sha256
    assert real_product.sp3.validation is not None
    assert real_product.sp3.validation.usable_satellite_count >= 100
    assert real_product.sp3.validation.usable_position_records > 20_000
    assert real_product.erp.snapshot_identity is not None

    provider = real_product.sp3.for_satellite(real_product.satellite_id)
    midpoint = provider.coverage_start + ((provider.coverage_stop - provider.coverage_start) / 2)
    native = provider.native_state_at(midpoint, time_scale=provider.native_time_scale)
    orientation = real_product.erp.at(midpoint)

    assert native.frame_realization == "IGB20"
    assert native.time_scale.value == "GPS"
    assert all(math.isfinite(component) for component in native.position_m)
    assert all(math.isfinite(component) for component in (orientation.xp_radians, orientation.yp_radians, orientation.dut1_seconds))
    assert real_product.erp.snapshot_identity.coverage_start <= midpoint <= real_product.erp.snapshot_identity.coverage_end


def test_real_pair_crosses_the_same_precise_product_import_boundary_as_an_uploaded_product(real_product: _RealProduct):
    """Exercise parsing, ERP time preflight and durable product provenance together."""

    uploads = [
        (
            dataset.path.name,
            base64.b64encode(dataset.path.read_bytes()).decode("ascii"),
        )
        for dataset in (
            real_product.files[CODE_MGEX_SP3.identifier],
            real_product.files[CODE_MGEX_ERP.identifier],
        )
    ]
    imported = import_precise_product(uploads, selected_satellite_ids=[real_product.satellite_id])

    assert imported.satellite_ids == (real_product.satellite_id,)
    assert imported.orbit_file.uploaded_sha256 == CODE_MGEX_SP3.expected_sha256
    assert imported.erp_file is not None
    assert imported.erp_file.uploaded_sha256 == CODE_MGEX_ERP.expected_sha256
    assert imported.time_validation_report is not None
    assert imported.time_validation_report.source_epoch_count >= 200
    assert imported.time_validation_report.utc_ut1_checked_epoch_count == imported.time_validation_report.source_epoch_count


@pytest.mark.performance
@pytest.mark.skipif(
    not is_real_data_performance_enabled(),
    reason="Rendimiento real desactivado; use ORBIT_RUN_REAL_DATA_PERFORMANCE=1 o -Performance.",
)
def test_real_sp3_native_interpolation_reports_and_respects_an_explicit_hardware_budget(real_product: _RealProduct):
    """Measure 1,000 bounded native interpolations without inventing a 5 ms claim.

    The original aspirational 5 ms total is not meaningful for the current
    pure-Python parser/interpolator and arbitrary developer hardware.  This
    opt-in regression gate uses a deliberately visible 1 s default budget;
    mission performance work must establish a benchmarked target separately.
    """

    provider = real_product.sp3.for_satellite(real_product.satellite_id)
    start = provider.coverage_start
    span = provider.coverage_stop - start
    queries = tuple(start + (span * ((index + 0.5) / 1_001.0)) for index in range(1_000))

    began = time.perf_counter()
    results = tuple(provider.native_state_at(moment, time_scale=provider.native_time_scale) for moment in queries)
    elapsed = time.perf_counter() - began
    limit = _performance_budget(1.0)
    print(
        "REAL_DATA_METRIC "
        f"sp3_native_interpolation points=1000 elapsed_seconds={elapsed:.6f} "
        f"milliseconds_per_point={(elapsed * 1_000.0 / len(results)):.6f} budget_seconds={limit:.6f}"
    )

    assert len(results) == 1_000
    assert elapsed <= limit, (
        f"1000 interpolaciones SP3 tardaron {elapsed:.6f} s; presupuesto explícito {limit:.6f} s. "
        "Ajuste ORBIT_REAL_DATA_PERF_MAX_SECONDS sólo tras registrar una referencia de hardware."
    )


def test_real_data_harness_declares_current_unavailable_reference_models_explicitly():
    """Avoid silently turning absent high-fidelity models into false validation claims."""

    unavailable = {
        key: value
        for key, value in REAL_DATA_CAPABILITIES.items()
        if key != "code_mgex_sp3_erp"
    }
    assert REAL_DATA_CAPABILITIES["code_mgex_sp3_erp"]["available"] is True
    assert unavailable
    assert all(value["available"] is False and value.get("reason") for value in unavailable.values())


@pytest.mark.parametrize(
    "capability",
    ("egm2008_2190x2190", "msise_nrlmsise", "de430_spice", "stk_gmat_24h_reference"),
)
def test_unavailable_real_data_reference_case_is_reported_as_an_explicit_skip(capability: str):
    """Make absence of a model/reference visible instead of fabricating evidence."""

    details = REAL_DATA_CAPABILITIES[capability]
    assert details["available"] is False
    pytest.skip(f"{capability}: {details['reason']}")

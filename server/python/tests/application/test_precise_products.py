"""Durable SP3/CLK precise-product import and runtime contracts."""

from __future__ import annotations

import base64
import gzip
import io
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from orbit_api.api.routes.ground_stations import create_ground_stations_router
from orbit_api.api.routes.orbits import create_orbits_router
from orbit_api.application import precise_products
from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.application.precise_products import (
    PreciseProductImportError,
    PreciseProductRepository,
    _decompress_unix_compress,
    decode_precise_product_upload,
    import_precise_product,
)
from orbit_api.domain.requests import AosLosRequest, StationInput
from orbit_api.frames import FrameId, build_frame_transformer_from_environment


def _sp3_header(*, frame: str = "ITRF", epochs: int = 2) -> str:
    return (
        "#cP"
        "2026 07 26 00 00 18.00000000"
        f" {epochs:7d} "
        f"{'ORBIT':<5} "
        f"{frame:<5} "
        f"{'FIT':<3} "
        f"{'COD':<4}"
    )


def _sp3_text(*, frame: str = "ITRF", include_velocity: bool = False) -> str:
    rows = [
        _sp3_header(frame=frame),
        "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        "*  2026 07 26 00 00 18.00000000",
        "PG01 7000.000000 0.000000 0.000000 0.123456",
    ]
    if include_velocity:
        rows.append("VG01 10000.000000 0.000000 0.000000 1.000000")
    rows.extend([
        "*  2026 07 26 00 01 18.00000000",
        "PG01 7060.000000 0.000000 0.000000 0.123457",
    ])
    if include_velocity:
        rows.append("VG01 10000.000000 0.000000 0.000000 1.000000")
    return "\n".join(rows)


def _minimal_sp3_text() -> str:
    """One-record SP3 fixture small enough for literal-only .Z coding.

    It is valid for ingestion and provenance checks.  Interpolation naturally
    requires a second epoch, so normal runtime tests continue to use the
    two-record fixture above.
    """

    return (
        f"{_sp3_header(epochs=1)}\n"
        "%c cc UTC\n"
        "*  2026 07 26 00 00 18.00000000\n"
        "PG01 7000.0 0.0 0.0 0.0"
    )


def _clk_text() -> str:
    return (
        "     3.04           C                   RINEX VERSION / TYPE\n"
        "GPS                                                         TIME SYSTEM ID\n"
        "                                                            END OF HEADER\n"
        "AS G01 2026 07 26 00 00 18.0000000  2  1.234567890D-04  2.0D-12"
    )


def _upload(name: str, content: str | bytes) -> tuple[str, str]:
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return name, base64.b64encode(raw).decode("ascii")


def _literal_unix_compress(value: bytes) -> bytes:
    """Small historical .Z fixture containing literal 9-bit LZW codes only."""

    assert len(value) < 255
    packed = 0
    bits = 0
    output = bytearray()
    for byte in value:
        packed |= byte << bits
        bits += 9
        while bits >= 8:
            output.append(packed & 0xFF)
            packed >>= 8
            bits -= 8
    if bits:
        output.append(packed & 0xFF)
    # 0x90: block mode plus a 16-bit maximum dictionary width.
    return b"\x1f\x9d\x90" + bytes(output)


def test_import_classifies_current_igs_final_and_associates_optional_rinex_clock():
    product = import_precise_product([
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3.gz", gzip.compress(_sp3_text().encode())),
        _upload("IGS0OPSFIN_20262070000_01D_30S_CLK.CLK", _clk_text()),
    ])

    assert product.provider_id == "cddis_igs"
    assert product.product_class == "final"
    assert product.product_family == "igs"
    assert product.satellite_ids == ("G01",)
    assert product.orbit_file.compression == "gzip"
    assert product.clock is not None
    clock = product.clock_summary("G01")
    assert clock["rinex_clk"]["sample_count"] == 1
    assert clock["rinex_clk"]["satellite_ids"] == ["G01"]
    assert clock["rinex_clk"]["coverage"]["start_time"] == "2026-07-26T00:00:18+00:00"
    payload = product.payload()
    assert payload["frame"] == "ITRF"
    assert payload["native_reference_frame"] == "ITRF"
    assert payload["renderer_reference"]["status"] == "native"
    assert payload["renderer_reference"]["earth_orientation"]["applied"] is False
    assert payload["time_system"] == "UTC"
    assert payload["clock"]["sp3_embedded"]["sample_count"] == 2


@pytest.mark.parametrize(
    ("file_name", "provider", "product_class", "product_family"),
    [
        ("ESA0OPSULT_20262070000_02D_15M_ORB.SP3", "esa_nso", "ultra_rapid", "esa_ops"),
        ("ESA0MGNFIN_20262070000_05D_05M_ORB.SP3", "esa_nso", "final", "mgex"),
        ("COD0MGXFIN_20262070000_01D_05M_ORB.SP3", "igs_mgex", "final", "mgex"),
        ("GFZ0MGXRAP_20262070000_01D_05M_ORB.SP3", "igs_mgex", "rapid", "mgex"),
        ("GFZ0MGXULT_20262070000_01D_05M_ORB.SP3", "igs_mgex", "ultra_rapid", "mgex"),
        ("ESA0MGNRAP_20262070000_01D_05M_ORB.SP3", "esa_nso", "rapid", "mgex"),
        ("igr23456.sp3", "cddis_igs", "rapid", "igs"),
    ],
)
def test_import_detects_esa_mgex_and_legacy_product_profiles(
    file_name,
    provider,
    product_class,
    product_family,
):
    product = import_precise_product([_upload(file_name, _sp3_text())])

    assert product.provider_id == provider
    assert product.product_class == product_class
    assert product.product_family == product_family
    assert product.payload()["detected"]["product_family"] == product_family


def test_explicit_provider_and_class_override_filename_detection_without_erasing_it():
    product = import_precise_product(
        [_upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text())],
        provider_hint="custom",
        product_class="rapid",
    )

    assert product.provider_id == "custom"
    assert product.product_class == "rapid"
    assert product.product_family == "custom"
    assert product.detected_provider_id == "cddis_igs"
    assert product.detected_product_class == "final"
    assert product.detected_product_family == "igs"


def test_persistence_keeps_esa_provider_separate_from_mgex_product_family(tmp_path):
    product = import_precise_product([
        _upload("ESA0MGNFIN_20262070000_05D_05M_ORB.SP3", _sp3_text()),
    ])
    repository = PreciseProductRepository(tmp_path / "precise-products")

    repository.save(product)
    loaded = repository.load(product.product_id)

    assert loaded.provider_id == "esa_nso"
    assert loaded.product_family == "mgex"
    assert loaded.payload()["detected"] == {
        "provider_id": "esa_nso",
        "product_class": "final",
        "product_family": "mgex",
    }
    assert loaded.satellite_payload("G01")["catalogMeta"]["product_family"] == "mgex"


def test_igc20_renderability_is_explicit_until_the_family_alignment_is_opted_in():
    upload = [_upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text(frame="IGc20"))]
    unavailable = import_precise_product(upload)

    rendering = unavailable.payload()["rendering"]
    assert rendering["available"] is False
    assert "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true" in rendering["reason"]

    transformer = build_frame_transformer_from_environment({
        "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
        "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT": "true",
    })
    available = import_precise_product(upload, frame_transformer=transformer)
    state = available.provider_for_satellite("G01").state_at(
        datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC),
        target_frame=FrameId.ITRF,
    )

    assert available.satellite_payload("G01")["sp3"]["rendering"]["available"] is True
    assert state.frame is FrameId.ITRF
    assert state.frame_realization == "ITRF2020"


def test_sp3_frame_contract_preserves_native_realization_and_marks_only_registered_itrf_output(tmp_path):
    upload = [_upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text(frame="IGc20"))]
    unavailable = import_precise_product(upload)

    native_provider = unavailable.provider_for_satellite("G01")
    assert native_provider.ephemeris_reference_frame == "IGC20"
    assert native_provider.ephemeris_reference_realization == "IGC20"
    rendering = unavailable.satellite_payload("G01")["renderer_reference"]
    assert rendering["native_reference_frame"] == "IGC20"
    assert rendering["status"] == "unavailable"
    assert rendering["available"] is False
    # A terrestrial SP3 realization is not rotated with EOP/ERP merely to
    # call it ITRF. It needs a separate, explicit datum operation.
    assert rendering["earth_orientation"]["required"] is False
    assert rendering["earth_orientation"]["applied"] is False

    transformer = build_frame_transformer_from_environment({
        "ORBIT_TERRESTRIAL_REALIZATION": "ITRF2020",
        "ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT": "true",
    })
    runtime = OrbitRuntime(
        transformer,
        precise_products_dir=tmp_path / "precise-products",
    )
    product = runtime.import_precise_product(upload)
    runtime_id, propagator = runtime.resolve_propagator(product.runtime_id("G01"), None, None)
    start = datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC)

    ephemeris = runtime.build_ephemeris(runtime_id, propagator, start, start, 30)

    assert ephemeris["native_reference_frame"] == "IGC20"
    assert ephemeris["native_frame"] == {
        "name": "IGS",
        "realization": "IGC20",
        "center": "EARTH",
        "time_scale": "UTC",
    }
    assert ephemeris["reference_frame"] == "ITRF2020"
    renderer = ephemeris["renderer_reference"]
    assert renderer["status"] == "terrestrial_realization_transform"
    assert renderer["target_frame"] == "ITRF"
    assert renderer["target_realization"] == "ITRF2020"
    assert renderer["earth_orientation"]["required"] is False
    assert renderer["earth_orientation"]["applied"] is False
    operation = renderer["terrestrial_realization_operation"]
    assert operation["source_realization"] == "IGC20"
    assert operation["target_realization"] == "ITRF2020"
    assert ephemeris["points"][0]["native_reference_frame"] == "IGC20"

    router = create_orbits_router(
        runtime.resolve_propagator,
        runtime.serialize_state,
        runtime.compute_auto_orbit_samples,
        runtime.build_ephemeris,
        runtime.renderer_state_at,
        runtime.native_state_at,
    )
    endpoint = next(route.endpoint for route in router.routes if route.path == "/propagate/{sat_id}")
    orbit_endpoint = next(route.endpoint for route in router.routes if route.path == "/orbits/{sat_id}")
    state_payload = endpoint(runtime_id, at=start)
    orbit_payload = orbit_endpoint(runtime_id, horizon_hours=1 / 120, samples=2, at=start)

    assert state_payload["reference_frame"] == "ITRF2020"
    assert state_payload["native_reference_frame"] == "IGC20"
    assert state_payload["renderer_reference"]["status"] == "terrestrial_realization_transform"
    assert orbit_payload["native_reference_frame"] == "IGC20"
    assert orbit_payload["renderer_reference"]["status"] == "terrestrial_realization_transform"


def test_zip_is_safely_inspected_and_must_contain_one_sp3_plus_optional_clk():
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("products/IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text())
        archive.writestr("products/IGS0OPSFIN_20262070000_01D_30S_CLK.CLK", _clk_text())
    product = import_precise_product([_upload("precise-product.zip", archive_bytes.getvalue())])

    assert product.clock_file is not None
    assert product.orbit_file.archive_member == "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3"
    assert product.orbit_file.compression == "none"

    unrelated = io.BytesIO()
    with zipfile.ZipFile(unrelated, "w") as archive:
        archive.writestr("readme.txt", "not an ephemeris")
    with pytest.raises(PreciseProductImportError, match="No se reconoce"):
        import_precise_product([_upload("anything.zip", unrelated.getvalue())])


def test_legacy_unix_compress_z_is_decoded_without_running_a_shell():
    # The minimal valid SP3 text stays below the first 9->10-bit dictionary
    # transition, so this literal-code fixture verifies the real .Z boundary
    # while keeping the test independent of a platform `compress` executable.
    text = _minimal_sp3_text().encode("ascii")
    assert len(text) < 255
    compressed = _literal_unix_compress(text)

    assert _decompress_unix_compress(compressed) == text
    product = import_precise_product([_upload("igs23456.sp3.Z", compressed)])

    assert product.provider_id == "cddis_igs"
    assert product.product_class == "final"
    assert product.orbit_file.compression == "unix-compress"


def test_decode_rejects_zip_path_traversal_and_duplicate_logical_source_names():
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w") as archive:
        archive.writestr("../escape.sp3", _sp3_text())
    with pytest.raises(PreciseProductImportError, match="ruta de miembro insegura"):
        decode_precise_product_upload([_upload("unsafe.zip", archive_bytes.getvalue())])

    with pytest.raises(PreciseProductImportError, match="duplicados"):
        decode_precise_product_upload([
            _upload("same.sp3", _sp3_text()),
            _upload("SAME.SP3", _sp3_text()),
        ])
    with pytest.raises(PreciseProductImportError, match="nombre de fichero no es seguro"):
        decode_precise_product_upload([_upload("nested/product.sp3", _sp3_text())])


def test_archive_expansion_uses_the_global_decompressed_budget(monkeypatch):
    """A ZIP member may use the aggregate 256 MiB budget, not a 32 MiB cap.

    The reduced test budget proves that ZIP extraction rejects the member
    before allocating beyond the same aggregate limit used by gzip and loose
    uploads.
    """

    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", b"x" * 33)
    monkeypatch.setattr(precise_products, "MAX_PRECISE_PRODUCT_EXPANDED_BYTES", 32)

    with pytest.raises(PreciseProductImportError, match="miembro ZIP demasiado grande"):
        decode_precise_product_upload([_upload("products.zip", archive_bytes.getvalue())])


def test_runtime_registers_p_only_sp3_uses_it_for_ephemeris_and_reloads_persisted_sources(tmp_path, monkeypatch):
    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    product = runtime.import_precise_product([
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text(include_velocity=False)),
    ])
    runtime_id = product.runtime_id("G01")
    name, propagator = runtime.resolve_propagator(runtime_id, None, None)
    start = datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC)

    result = runtime.build_ephemeris(name, propagator, start, start + timedelta(seconds=60), 30)

    assert result["count"] == 3
    assert "velocity" not in result["points"][0]
    assert runtime.precise_product_import_payload(product)["importedIds"] == [runtime_id]

    # Startup reload must restore runtime IDs from content-addressed config
    # files without re-uploading them through the browser.
    monkeypatch.setattr(
        "orbit_api.application.orbit_runtime.load_system_config",
        lambda: ({}, {"satellites_catalog_file": "catalog.json"}),
    )
    monkeypatch.setattr(
        "orbit_api.application.orbit_runtime.load_all_tles_from_config",
        lambda _path: [],
    )
    reloaded = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    reloaded.load_constellation()

    assert reloaded.resolve_propagator(runtime_id, None, None)[0] == runtime_id
    assert reloaded.precise_products_payload()["items"][0]["satellites"][0]["id"] == runtime_id


def test_runtime_reports_out_of_coverage_precise_source_without_crashing_realtime_or_orbit_payload(tmp_path):
    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    product = runtime.import_precise_product([
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text()),
    ])
    runtime_id = product.runtime_id("G01")
    _props, _config, by_name = runtime.get_state_snapshot()

    realtime = runtime.build_realtime_state(by_name, [runtime_id])
    orbit_payload = runtime.build_orbit_payload([(runtime_id, by_name[runtime_id])], {"orbit_future_show": True})

    assert len(realtime) == 1
    assert realtime[0]["satellite"] == runtime_id
    assert realtime[0]["availability"] == "unavailable"
    assert realtime[0]["reason"] == "out-of-coverage-or-frame-unavailable"
    assert isinstance(realtime[0]["detail"], str)
    assert orbit_payload[0]["availability"] == "unavailable"
    assert orbit_payload[0]["orbit"] == []


def test_runtime_returns_an_actionable_http_error_for_out_of_coverage_ephemeris(tmp_path):
    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    product = runtime.import_precise_product([
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text()),
    ])
    runtime_id, propagator = runtime.resolve_propagator(product.runtime_id("G01"), None, None)

    with pytest.raises(HTTPException) as raised:
        runtime.build_ephemeris(
            runtime_id,
            propagator,
            datetime(2030, 1, 1, tzinfo=UTC),
            datetime(2030, 1, 1, 0, 1, tzinfo=UTC),
            30,
        )

    assert raised.value.status_code == 422
    assert "no está disponible" in str(raised.value.detail)


def test_precise_runtime_id_is_usable_by_the_shared_aos_los_route(tmp_path):
    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    product = runtime.import_precise_product([
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text()),
    ])
    runtime_id = product.runtime_id("G01")
    router = create_ground_stations_router(
        runtime.resolve_propagator,
        runtime.build_ephemeris,
        runtime.ensure_utc,
        runtime.frame_transformer,
    )
    endpoint = next(
        route.endpoint
        for route in router.routes
        if route.path == "/aos-los" and "POST" in route.methods
    )
    start = datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC)
    response = endpoint(AosLosRequest(
        source={"kind": "catalog", "satId": runtime_id},
        station=StationInput(lat_deg=0, lon_deg=0, min_elevation_deg=0),
        start_time=start,
        end_time=start + timedelta(seconds=60),
        step_seconds=30,
    ))

    assert response["satellite"] == runtime_id
    assert response["reference_frame"] == "ITRF"
    assert response["native_reference_frame"] == "ITRF"
    assert response["renderer_reference"]["status"] == "native"
    assert response["count"] == 3
    assert response["passes"]


def test_precise_runtime_id_accepts_an_explicit_utc_orbit_anchor(tmp_path):
    runtime = OrbitRuntime(precise_products_dir=tmp_path / "precise-products")
    product = runtime.import_precise_product([
        _upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text(include_velocity=False)),
    ])
    runtime_id = product.runtime_id("G01")
    router = create_orbits_router(
        runtime.resolve_propagator,
        runtime.serialize_state,
        runtime.compute_auto_orbit_samples,
        runtime.build_ephemeris,
        runtime.renderer_state_at,
    )
    orbit_endpoint = next(route.endpoint for route in router.routes if route.path == "/orbits/{sat_id}")
    state_endpoint = next(route.endpoint for route in router.routes if route.path == "/propagate/{sat_id}")
    start = datetime(2026, 7, 26, 0, 0, 18, tzinfo=UTC)

    orbit = orbit_endpoint(runtime_id, horizon_hours=1 / 60, samples=3, at=start)
    state = state_endpoint(runtime_id, at=start)

    assert orbit["orbit_reference_time"] == start.isoformat()
    assert len(orbit["orbit"]) == 3
    assert state["satellite"] == runtime_id
    assert "velocity" not in state


def test_repository_detects_tampered_persisted_source_before_runtime_registration(tmp_path):
    repository = PreciseProductRepository(tmp_path / "precise-products")
    product = import_precise_product([_upload("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", _sp3_text())])
    repository.save(product)
    stored_source = next((tmp_path / "precise-products" / product.product_id).glob("[0-9][0-9]-*"))
    stored_source.write_text("tampered", encoding="utf-8")

    with pytest.raises(PreciseProductImportError, match="checksum"):
        repository.load(product.product_id)

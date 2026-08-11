"""HTTP contract tests for local precise-product imports."""

from __future__ import annotations

import asyncio
import base64
import gzip
import json

import pytest
from fastapi import FastAPI, HTTPException
from orbit_api.api.routes.precise_products import create_precise_products_router
from orbit_api.application.orbit_runtime import OrbitRuntime
from orbit_api.application.precise_products import (
    PreciseProductImportError,
    import_precise_product,
)
from orbit_api.domain.requests import PreciseProductImportRequest
from pydantic import ValidationError


def _endpoint(router, path: str):
    return next(route.endpoint for route in router.routes if route.path == path)


def _strict_sp3_position_record(
    satellite_id: str,
    x: float | str,
    y: float = 0.0,
    z: float = 0.0,
    clock: float = 0.0,
) -> str:
    """Build a fixed-column position record for strict SP3 route fixtures."""

    def component(value: float | str) -> str:
        return f"{value:14.6f}" if isinstance(value, (int, float)) else f"{value!s:>14}"

    return (
        f"P{satellite_id}"
        f"{component(x)}{component(y)}{component(z)}{component(clock)}"
    )


def _strict_sp3_source(
    *,
    declared_satellites: tuple[str, ...] = ("G01",),
    interval_seconds: int = 60,
    second_epoch_minute: int = 1,
    first_position: str = "7000.000000",
) -> str:
    """Small complete SP3 table accepted by strict upload validation."""

    declared = "".join(declared_satellites)
    records = "\n".join(
        _strict_sp3_position_record(
            identifier,
            first_position if index == 0 else 26000.0,
        )
        for index, identifier in enumerate(declared_satellites)
    )
    second_records = "\n".join(
        _strict_sp3_position_record(identifier, 7060.0 if index == 0 else 26060.0)
        for index, identifier in enumerate(declared_satellites)
    )
    return "\n".join((
        "#cP2026 07 26 00 00 18.00000000       2 ORBIT ITRF  FIT COD",
        f"## 0000 0 {interval_seconds:.8f} 0 0",
        f"+{len(declared_satellites):5d}   {declared}",
        "%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc",
        "*  2026 07 26 00 00 18.00000000",
        records,
        f"*  2026 07 26 00 {second_epoch_minute:02d} 18.00000000",
        second_records,
    ))


async def _asgi_json_request(app: FastAPI, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    """Exercise FastAPI's ASGI endpoint without an optional HTTP test client."""

    body = json.dumps(payload).encode("utf-8") if payload is not None else b""
    sent: list[dict] = []
    received = False

    async def receive() -> dict:
        nonlocal received
        if received:
            return {"type": "http.disconnect"}
        received = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict) -> None:
        sent.append(message)

    await app({
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }, receive, send)
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"")
        for message in sent
        if message["type"] == "http.response.body"
    )
    return status, json.loads(response_body)


def test_precise_product_routes_expose_post_runtime_entries_and_get_hydration_shape():
    calls: list[tuple[list[tuple[str, str]], bool]] = []
    product = object()

    def import_product(files, *, require_eci=False):
        calls.append((files, require_eci))
        return product

    post_payload = {
        "ok": True,
        "product": {"id": "precise-0123456789abcdef0123"},
        "satellites": [{"id": "precise:precise-0123456789abcdef0123:G01", "sourceFormat": "SP3"}],
        "importedIds": ["precise:precise-0123456789abcdef0123:G01"],
    }
    hydration = {"items": [{key: post_payload[key] for key in ("product", "satellites", "importedIds")}], "diagnostics": []}
    router = create_precise_products_router(import_product, lambda: hydration, lambda value: post_payload)
    request = PreciseProductImportRequest(
        files=[{
            "name": "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3",
            "contentBase64": base64.b64encode(b"sp3").decode("ascii"),
        }],
    )

    imported = _endpoint(router, "/precise-products/import")(request)
    listed = _endpoint(router, "/precise-products")()

    assert imported == post_payload
    assert listed == hydration
    assert calls == [(
        [("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", base64.b64encode(b"sp3").decode("ascii"))],
        False,
    )]


def test_precise_product_preview_uses_a_non_persisting_service_and_returns_selectable_gnss_members():
    calls: list[tuple[list[tuple[str, str]], bool]] = []
    source = _strict_sp3_source(declared_satellites=("G01", "C06"))

    def must_not_import(*_args, **_kwargs):
        raise AssertionError("preview must not call the persistent import service")

    def preview_product(files, *, require_eci=False):
        calls.append((files, require_eci))
        return import_precise_product(files, require_eci=require_eci)

    router = create_precise_products_router(
        must_not_import,
        lambda: {"items": [], "diagnostics": []},
        preview_product=preview_product,
    )
    encoded = base64.b64encode(source.encode("ascii")).decode("ascii")
    request = PreciseProductImportRequest(
        sp3={"name": "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", "content_base64": encoded},
    )

    preview = _endpoint(router, "/precise-products/preview")(request)

    assert preview["ok"] is True
    assert preview["preview"]["product"]["persistence"] == {
        "scope": "preview", "reloadable": False,
    }
    assert [(item["satellite_id"], item["constellation"]) for item in preview["preview"]["satellites"]] == [
        ("G01", "GPS"),
        ("C06", "BeiDou"),
    ]
    assert calls == [([("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", encoded)], False)]


def test_precise_product_preview_endpoint_does_not_create_a_runtime_product(tmp_path):
    source = _strict_sp3_source()
    storage = tmp_path / "precise-products"
    runtime = OrbitRuntime(precise_products_dir=storage)
    router = create_precise_products_router(
        runtime.import_precise_product,
        runtime.precise_products_payload,
        runtime.precise_product_import_payload,
        runtime.preview_precise_product,
    )
    request = PreciseProductImportRequest(
        sp3={
            "name": "product.SP3",
            "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
        },
    )

    response = _endpoint(router, "/precise-products/preview")(request)

    assert response["ok"] is True
    assert [satellite["id"] for satellite in response["preview"]["satellites"]] == ["G01"]
    assert runtime.precise_products_payload() == {"items": [], "diagnostics": []}
    assert not storage.exists()


def test_strict_sp3_import_exposes_the_successful_validation_report():
    router = create_precise_products_router(
        import_precise_product,
        lambda: {"items": [], "diagnostics": []},
    )
    source = _strict_sp3_source(declared_satellites=("G01", "C06"))
    response = _endpoint(router, "/precise-products/import")(
        PreciseProductImportRequest(
            sp3={
                "name": "product.SP3",
                "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
            },
        )
    )

    report = response["product"]["sp3_validation"]
    assert report == {
        "status": "passed",
        "header": {
            "epoch_count": 2,
            "satellite_count": 2,
            "satellite_ids_declared": ["G01", "C06"],
        },
        "epochs": {
            "count": 2,
            "cadence_seconds": 60.0,
            "header_cadence_seconds": 60.0,
            "cadence_tolerance_seconds": 2e-6,
        },
        "positions": {
            "usable_records": 4,
            "missing_sentinel_records": 0,
            "usable_satellite_count": 2,
        },
        "interpolation": {
            "method": "LAGRANGE",
            "max_degree": 9,
            "degree_policy": "min(9, usable_sample_count - 1); one sample is exact-only",
            "checked_satellite_count": 2,
            "checked_knot_count": 4,
            "stability_window_count": 2,
            "max_knot_error_m": 0.0,
            "knot_tolerance_m": 1e-9,
            "max_lebesgue_constant": 1.0,
            "lebesgue_threshold": 512.0,
            "min_barycentric_denominator_relative": 1.0,
            "barycentric_denominator_relative_threshold": 1e-5,
            "degree_summary": {
                "exact_only_satellite_count": 0,
                "lagrange_satellite_count": 2,
                "full_degree_satellite_count": 0,
                "reduced_degree_satellite_count": 2,
                "minimum_lagrange_degree": 1,
                "maximum_lagrange_degree": 1,
            },
        },
    }


def test_strict_sp3_import_keeps_official_missing_position_sentinels_out_of_cartesian_states():
    router = create_precise_products_router(
        import_precise_product,
        lambda: {"items": [], "diagnostics": []},
    )
    source = _strict_sp3_source().replace(
        _strict_sp3_position_record("G01", 7060.0),
        _strict_sp3_position_record("G01", 0.0, 0.0, 0.0, 999999.999999),
    )
    response = _endpoint(router, "/precise-products/import")(
        PreciseProductImportRequest(
            sp3={
                "name": "product.SP3",
                "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
            },
        )
    )

    report = response["product"]["sp3_validation"]
    assert report["positions"] == {
        "usable_records": 1,
        "missing_sentinel_records": 1,
        "usable_satellite_count": 1,
    }
    assert report["interpolation"]["checked_knot_count"] == 0
    assert report["interpolation"]["degree_summary"] == {
        "exact_only_satellite_count": 1,
        "lagrange_satellite_count": 0,
        "full_degree_satellite_count": 0,
        "reduced_degree_satellite_count": 0,
        "minimum_lagrange_degree": None,
        "maximum_lagrange_degree": None,
    }
    assert response["product"]["satellite_ids"] == ["G01"]


def test_strict_sp3_import_accepts_a_full_width_negative_cartesian_record():
    router = create_precise_products_router(
        import_precise_product,
        lambda: {"items": [], "diagnostics": []},
    )
    source = _strict_sp3_source().replace(
        _strict_sp3_position_record("G01", "7000.000000"),
        "PG01 -15279.754555  21565.222433   2494.061616    255.330406",
    )
    response = _endpoint(router, "/precise-products/import")(
        PreciseProductImportRequest(
            sp3={
                "name": "product.SP3",
                "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
            },
        )
    )

    assert response["product"]["sp3_validation"]["status"] == "passed"


@pytest.mark.parametrize(
    ("source", "expected_error"),
    [
        (
            _strict_sp3_source().replace("+    1   G01", "+    2   G01"),
            "El número de satélites SP3 no coincide con la lista de la cabecera",
        ),
        (
            _strict_sp3_source(second_epoch_minute=2),
            "SP3 contiene un salto de época: la cadencia no coincide con la cabecera ##",
        ),
        (
            _strict_sp3_source(first_position="NaN"),
            "Un registro SP3 contiene componentes no finitos",
        ),
        (
            _strict_sp3_source().replace("#cP", "#zP", 1),
            "La versión SP3 no es compatible con la importación estricta",
        ),
        (
            _strict_sp3_source().replace(
                _strict_sp3_position_record("G01", "7000.000000"),
                "PG01                 100.0 200.0 0.123456",
            ),
            "Un registro SP3 P/V no contiene las columnas cartesianas obligatorias",
        ),
        (
            _strict_sp3_source().replace(
                _strict_sp3_position_record("G01", "7000.000000"),
                f"PG01{'7000.000000':>14}{'':>14}{'100.000000':>14}{'0.123456':>14}",
            ),
            "Un registro SP3 contiene un componente cartesiano vacío",
        ),
    ],
)
def test_strict_sp3_import_rejects_invalid_source_without_persisting(
    tmp_path,
    source,
    expected_error,
):
    storage = tmp_path / "precise-products"
    runtime = OrbitRuntime(precise_products_dir=storage)
    router = create_precise_products_router(
        runtime.import_precise_product,
        runtime.precise_products_payload,
        runtime.precise_product_import_payload,
        runtime.preview_precise_product,
    )

    with pytest.raises(HTTPException) as raised:
        _endpoint(router, "/precise-products/import")(
            PreciseProductImportRequest(
                sp3={
                    "name": "product.SP3",
                    "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
                },
            )
        )

    assert raised.value.status_code == 422
    assert raised.value.detail == expected_error
    assert runtime.precise_products_payload() == {"items": [], "diagnostics": []}
    assert not storage.exists()


def test_precise_product_import_forwards_an_explicit_satellite_subset():
    calls: list[tuple[list[tuple[str, str]], list[str] | None]] = []
    product = object()

    def import_product(files, *, selected_satellite_ids=None):
        calls.append((files, selected_satellite_ids))
        return product

    router = create_precise_products_router(
        import_product,
        lambda: {"items": [], "diagnostics": []},
        lambda _product: {"ok": True},
    )
    encoded = base64.b64encode(b"sp3").decode("ascii")
    request = PreciseProductImportRequest(
        files=[{"name": "product.SP3", "content_base64": encoded}],
        selectedSatelliteIds=["c06", "G01"],
    )

    assert _endpoint(router, "/precise-products/import")(request) == {"ok": True}
    assert calls == [([("product.SP3", encoded)], ["C06", "G01"])]


def test_precise_product_route_projects_import_validation_failures_to_422():
    router = create_precise_products_router(
        lambda *_args, **_kwargs: (_ for _ in ()).throw(PreciseProductImportError("base64 no válido")),
        lambda: {"items": [], "diagnostics": []},
    )
    request = PreciseProductImportRequest(
        files=[{"name": "product.sp3", "content_base64": "Zm9v"}],
    )

    with pytest.raises(HTTPException) as raised:
        _endpoint(router, "/precise-products/import")(request)

    assert raised.value.status_code == 422
    assert raised.value.detail == "base64 no válido"


def test_precise_product_route_rejects_malformed_base64_with_422_before_parsing():
    router = create_precise_products_router(
        import_precise_product,
        lambda: {"items": [], "diagnostics": []},
    )
    request = PreciseProductImportRequest(
        files=[{"name": "product.sp3", "content_base64": "%%%not-base64%%%"}],
    )

    with pytest.raises(HTTPException) as raised:
        _endpoint(router, "/precise-products/import")(request)

    assert raised.value.status_code == 422
    assert "base64" in str(raised.value.detail)


def test_precise_product_request_rejects_bad_or_oversized_upload_shape_before_import():
    with pytest.raises(ValidationError):
        PreciseProductImportRequest(files=[{"name": "", "content_base64": "Zm9v"}])
    with pytest.raises(ValidationError):
        PreciseProductImportRequest(files=[{
            "name": "product.sp3",
            "content_base64": "A" * (((32 * 1024 * 1024 * 4) // 3) + 17),
        }])


def test_precise_product_request_deduplicates_named_slots_and_rejects_a_mismatched_slot_suffix():
    encoded = base64.b64encode(b"sp3").decode("ascii")
    request = PreciseProductImportRequest(
        files=[{"name": "product.SP3", "kind": "sp3", "content_base64": encoded}],
        sp3={"name": "product.SP3", "kind": "sp3", "content_base64": encoded},
    )

    assert [(item.name, item.kind) for item in request.uploads()] == [("product.SP3", "sp3")]
    with pytest.raises(ValidationError, match="campo SP3|extensión"):
        PreciseProductImportRequest(
            sp3={"name": "product.txt", "kind": "sp3", "content_base64": encoded},
        )
    with pytest.raises(ValidationError, match="campo SP3 solo admite"):
        PreciseProductImportRequest(
            sp3={"name": "bundle.zip", "kind": "sp3", "content_base64": encoded},
        )
    with pytest.raises(ValidationError, match="campo SP3 solo admite"):
        PreciseProductImportRequest(
            sp3={"name": "legacy.SP3c", "kind": "sp3", "content_base64": encoded},
        )
    with pytest.raises(ValidationError, match="tipo declarado ERP"):
        PreciseProductImportRequest(
            files=[{"name": "product.SP3", "kind": "erp", "content_base64": encoded}],
        )
    request = PreciseProductImportRequest(
        sum={"name": "summary.SUM.gz", "kind": "sum", "content_base64": encoded},
        att={"name": "attitude.OBX.gz", "kind": "att", "content_base64": encoded},
        osb={"name": "bias.BIA.gz", "kind": "osb", "content_base64": encoded},
    )
    assert [(item.name, item.kind) for item in request.uploads()] == [
        ("summary.SUM.gz", "sum"),
        ("attitude.OBX.gz", "att"),
        ("bias.BIA.gz", "osb"),
    ]
    att_alias = PreciseProductImportRequest(
        att={"name": "attitude.ATT.gz", "kind": "att", "content_base64": encoded},
    )
    assert [(item.name, item.kind) for item in att_alias.uploads()] == [
        ("attitude.ATT.gz", "att"),
    ]


def test_precise_product_request_rejects_manual_provenance_or_product_class():
    encoded = base64.b64encode(b"sp3").decode("ascii")

    with pytest.raises(ValidationError, match="procedencia y la clase"):
        PreciseProductImportRequest(
            sp3={"name": "product.SP3", "kind": "sp3", "content_base64": encoded},
            providerHint="esa-nso",
        )
    with pytest.raises(ValidationError, match="procedencia y la clase"):
        PreciseProductImportRequest(
            sp3={"name": "product.SP3", "kind": "sp3", "content_base64": encoded},
            productClass="rapid",
        )


def test_precise_product_request_validates_optional_selected_satellite_ids():
    encoded = base64.b64encode(b"sp3").decode("ascii")
    request = PreciseProductImportRequest(
        sp3={"name": "product.SP3", "kind": "sp3", "content_base64": encoded},
        selectedSatelliteIds=["g01", "C06"],
    )

    assert request.selected_satellite_ids == ["G01", "C06"]
    with pytest.raises(ValidationError, match="Seleccione al menos"):
        PreciseProductImportRequest(
            sp3={"name": "product.SP3", "kind": "sp3", "content_base64": encoded},
            selected_satellite_ids=[],
        )
    with pytest.raises(ValidationError, match="no pueden repetirse"):
        PreciseProductImportRequest(
            sp3={"name": "product.SP3", "kind": "sp3", "content_base64": encoded},
            selected_satellite_ids=["G01", "g01"],
        )


def test_precise_product_route_projects_exact_missing_sp3_and_erp_for_eci_errors():
    router = create_precise_products_router(
        import_precise_product,
        lambda: {"items": [], "diagnostics": []},
    )
    endpoint = _endpoint(router, "/precise-products/import")

    with pytest.raises(HTTPException) as missing_sp3:
        endpoint(PreciseProductImportRequest(
            erp={
                "name": "product.ERP",
                "kind": "erp",
                "content_base64": base64.b64encode(b"MJD Xpole Ypole UT1-UTC LOD\n").decode("ascii"),
            },
        ))
    assert missing_sp3.value.status_code == 422
    assert missing_sp3.value.detail == "Debe proporcionar un fichero SP3."

    source = _strict_sp3_source()
    with pytest.raises(HTTPException) as missing_erp:
        endpoint(PreciseProductImportRequest(
            sp3={
                "name": "product.SP3",
                "kind": "sp3",
                "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
            },
            requireEci=True,
        ))
    assert missing_erp.value.status_code == 422
    assert missing_erp.value.detail == "Debe proporcionar un fichero ERP para convertir a ECI."


def test_precise_product_route_rejects_selected_satellites_not_declared_by_the_sp3():
    source = _strict_sp3_source()
    router = create_precise_products_router(import_precise_product, lambda: {"items": [], "diagnostics": []})
    request = PreciseProductImportRequest(
        sp3={
            "name": "product.SP3",
            "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
        },
        selected_satellite_ids=["C06"],
    )

    with pytest.raises(HTTPException) as raised:
        _endpoint(router, "/precise-products/import")(request)

    assert raised.value.status_code == 422
    assert raised.value.detail == "El SP3 no contiene los satélites seleccionados: C06."


def test_precise_product_route_imports_every_optional_gnss_member_with_automatic_metadata():
    """All six dialog slots must reach the parser in one normal import.

    The final three products are deliberately exercised with the common
    compressed SUM and standalone OBX/BIA filename variants.  They remain
    optional source companions; no ECI request is made, so ERP is optional
    even though it is supplied here.
    """

    source = _strict_sp3_source()
    erp = """version 2
MJD Xpole Ypole UT1-UTC LOD Xsig Ysig UTsig LODsig Nr Nf Nt Xrt Yrt
61247.0 100000 -200000 2500000 10000 0 0 0 0 0 0 0 0 0
61248.0 200000 -100000 3500000 20000 0 0 0 0 0 0 0 0 0"""
    encode = lambda value: base64.b64encode(value).decode("ascii")
    request = PreciseProductImportRequest(
        sp3={"name": "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", "kind": "sp3", "content_base64": encode(source.encode())},
        clk={"name": "IGS0OPSFIN_20262070000_01D_30S_CLK.CLK", "kind": "clk", "content_base64": encode(b"     3.04           C                   RINEX VERSION / TYPE\nGPS                                                         TIME SYSTEM ID\n                                                            END OF HEADER\nAS G01 2026 07 26 00 00 18.0000000  2  1.234567890D-04  2.0D-12")},
        erp={"name": "IGS0OPSFIN_20262070000_01D_ERP.ERP", "kind": "erp", "content_base64": encode(erp.encode())},
        sum={"name": "IGS0OPSFIN_20262070000_01D_SUM.SUM.gz", "kind": "sum", "content_base64": encode(gzip.compress(b"summary"))},
        att={"name": "IGS0OPSFIN_20262070000_01D_ATT.OBX.gz", "kind": "att", "content_base64": encode(gzip.compress(b"attitude"))},
        osb={"name": "IGS0OPSFIN_20262070000_01D_OSB.BIA.gz", "kind": "osb", "content_base64": encode(gzip.compress(b"bias"))},
    )
    router = create_precise_products_router(import_precise_product, lambda: {"items": [], "diagnostics": []})

    imported = _endpoint(router, "/precise-products/import")(request)

    assert imported["ok"] is True
    assert {item["kind"] for item in imported["product"]["source_files"]} == {
        "sp3", "clk", "erp", "sum", "att", "osb",
    }
    # The UI must not provide a provenance/class selection: these values are
    # inferred from the IGS filename family.
    assert imported["product"]["provider_id"] == "cddis_igs"
    assert imported["product"]["product_class"] == "final"


def test_precise_product_fastapi_endpoints_return_the_public_post_and_get_contract():
    source = _strict_sp3_source()
    app = FastAPI()
    app.include_router(create_precise_products_router(
        import_precise_product,
        lambda: {"items": [], "diagnostics": []},
        lambda product: {
            "ok": True,
            "product": product.payload(),
            "satellites": [product.satellite_payload("G01")],
            "importedIds": [product.runtime_id("G01")],
        },
    ))
    request = {
        "files": [{
            "name": "IGS0OPSFIN_20262070000_01D_05M_ORB.SP3",
            "content_base64": base64.b64encode(source.encode("ascii")).decode("ascii"),
        }],
    }

    imported_status, imported = asyncio.run(_asgi_json_request(app, "POST", "/precise-products/import", request))
    listed_status, listed = asyncio.run(_asgi_json_request(app, "GET", "/precise-products"))
    malformed_status, malformed = asyncio.run(_asgi_json_request(app, "POST", "/precise-products/import", {
        "files": [{"name": "invalid.sp3", "content_base64": "%%%not-base64%%%"}],
    }))

    assert imported_status == 200
    assert imported["ok"] is True
    assert {"product", "satellites", "importedIds"} <= imported.keys()
    assert imported["satellites"][0]["sourceFormat"] == "SP3"
    assert listed_status == 200
    assert listed == {"items": [], "diagnostics": []}
    assert malformed_status == 422
    assert "base64" in malformed["detail"]

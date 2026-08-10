"""HTTP contract tests for local precise-product imports."""

from __future__ import annotations

import asyncio
import base64
import json

import pytest
from fastapi import FastAPI, HTTPException
from orbit_api.api.routes.precise_products import create_precise_products_router
from orbit_api.application.precise_products import (
    PreciseProductImportError,
    import_precise_product,
)
from orbit_api.domain.requests import PreciseProductImportRequest
from pydantic import ValidationError


def _endpoint(router, path: str):
    return next(route.endpoint for route in router.routes if route.path == path)


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
    calls: list[tuple[list[tuple[str, str]], str, str]] = []
    product = object()

    def import_product(files, *, provider_hint, product_class):
        calls.append((files, provider_hint, product_class))
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
        providerHint="cddis-igs",
        productClass="final",
    )

    imported = _endpoint(router, "/precise-products/import")(request)
    listed = _endpoint(router, "/precise-products")()

    assert imported == post_payload
    assert listed == hydration
    assert calls == [(
        [("IGS0OPSFIN_20262070000_01D_05M_ORB.SP3", base64.b64encode(b"sp3").decode("ascii"))],
        "cddis-igs",
        "final",
    )]


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


def test_precise_product_fastapi_endpoints_return_the_public_post_and_get_contract():
    source = """#cP2026 07 26 00 00 18.00000000       2 ORBIT ITRF  FIT COD 
%c cc UTC ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc ccc
*  2026 07 26 00 00 18.00000000
PG01 7000.000000 0.000000 0.000000 0.000000
*  2026 07 26 00 01 18.00000000
PG01 7060.000000 0.000000 0.000000 0.000000"""
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

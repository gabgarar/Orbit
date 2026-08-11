"""HTTP endpoints for durable local precise GNSS product imports."""

import inspect
from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from orbit_api.application.precise_products import PreciseProductImportError
from orbit_api.domain.requests import PreciseProductImportRequest


def create_precise_products_router(
    import_product: Callable,
    list_products: Callable,
    serialize_import: Callable | None = None,
) -> APIRouter:
    """Expose the SP3-centred GNSS product import/hydration contract."""

    router = APIRouter(tags=["precise-products"])

    @router.get("/precise-products")
    def list_precise_products() -> dict:
        """Return persisted products and their runtime-ready satellite IDs."""

        return list_products()

    @router.post("/precise-products/import")
    def import_precise_product_endpoint(payload: PreciseProductImportRequest) -> dict:
        """Persist one local precise product after strict archive validation."""

        try:
            # ``create_precise_products_router`` is intentionally injectable
            # for service hosts and tests.  Provenance/class are always
            # derived from the source files, so the only optional capability
            # request forwarded here is the future ECI guard.
            kwargs = {}
            if _accepts_keyword(import_product, "require_eci"):
                kwargs["require_eci"] = payload.require_eci
            product = import_product(
                [(file.name, file.content_base64) for file in payload.uploads()],
                **kwargs,
            )
        except PreciseProductImportError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        # OrbitRuntime owns response serialisation so POST and the startup
        # hydration GET always return the same runtime identifiers/metadata.
        if callable(serialize_import):
            return serialize_import(product)
        return {"ok": True, "product": product.payload()}

    return router


def _accepts_keyword(callback: Callable, keyword: str) -> bool:
    """Return whether an injected callable can receive ``keyword``.

    A few extension callables are implemented in C or use signatures that
    cannot be inspected.  In that case, prefer the modern contract; any real
    application error must remain visible rather than being hidden by a broad
    ``TypeError`` fallback.
    """

    try:
        parameters = inspect.signature(callback).parameters.values()
    except (TypeError, ValueError):
        return True
    return any(
        parameter.name == keyword or parameter.kind is inspect.Parameter.VAR_KEYWORD
        for parameter in parameters
    )

"""HTTP endpoints for durable local precise GNSS product imports."""

from collections.abc import Callable

from fastapi import APIRouter, HTTPException

from orbit_api.application.precise_products import PreciseProductImportError
from orbit_api.domain.requests import PreciseProductImportRequest


def create_precise_products_router(
    import_product: Callable,
    list_products: Callable,
    serialize_import: Callable | None = None,
) -> APIRouter:
    """Expose the SP3 + optional RINEX CLK import/hydration contract."""

    router = APIRouter(tags=["precise-products"])

    @router.get("/precise-products")
    def list_precise_products() -> dict:
        """Return persisted products and their runtime-ready satellite IDs."""

        return list_products()

    @router.post("/precise-products/import")
    def import_precise_product_endpoint(payload: PreciseProductImportRequest) -> dict:
        """Persist one local precise product after strict archive validation."""

        try:
            product = import_product(
                [(file.name, file.content_base64) for file in payload.files],
                provider_hint=payload.provider_hint,
                product_class=payload.product_class,
            )
        except PreciseProductImportError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        # OrbitRuntime owns response serialisation so POST and the startup
        # hydration GET always return the same runtime identifiers/metadata.
        if callable(serialize_import):
            return serialize_import(product)
        return {"ok": True, "product": product.payload()}

    return router

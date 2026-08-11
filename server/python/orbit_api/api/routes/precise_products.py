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
    preview_product: Callable | None = None,
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
            if payload.selected_satellite_ids is not None:
                if not _accepts_keyword(import_product, "selected_satellite_ids"):
                    raise PreciseProductImportError(
                        "La importación parcial de satélites SP3 no está disponible en este servicio."
                    )
                kwargs["selected_satellite_ids"] = payload.selected_satellite_ids
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

    @router.post("/precise-products/preview")
    def preview_precise_product_endpoint(payload: PreciseProductImportRequest) -> dict:
        """Validate and parse a GNSS product without persisting it.

        The browser uses this endpoint before it lets an operator choose a
        subset of satellites.  It must be wired to OrbitRuntime's preview
        service; deliberately never falling back to ``import_product`` keeps
        canceling the dialog free of filesystem or registry side effects.
        """

        if not callable(preview_product):
            raise HTTPException(
                status_code=501,
                detail="La previsualización de productos GNSS no está disponible en este servicio.",
            )
        try:
            kwargs = {}
            if _accepts_keyword(preview_product, "require_eci"):
                kwargs["require_eci"] = payload.require_eci
            product = preview_product(
                [(file.name, file.content_base64) for file in payload.uploads()],
                **kwargs,
            )
        except PreciseProductImportError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"ok": True, "preview": _preview_payload(product)}

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


def _preview_payload(product: object) -> dict:
    """Serialize the non-persistent preview without manufacturing layers."""

    serializer = getattr(product, "preview_payload", None)
    if callable(serializer):
        return serializer()
    # Kept only for narrowly injected test/service adapters.  The production
    # application returns PreciseProduct and therefore takes the branch above.
    payload = getattr(product, "payload", None)
    if callable(payload):
        return {"product": payload(), "satellites": []}
    raise PreciseProductImportError("El servicio devolvió una previsualización GNSS inválida.")

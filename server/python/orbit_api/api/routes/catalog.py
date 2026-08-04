"""Catalog HTTP endpoints."""

from collections.abc import Callable

from fastapi import APIRouter


def create_catalog_router(list_satellite_ids: Callable[[], list[str]]) -> APIRouter:
    """Build the catalog transport adapter from an application callback."""
    router = APIRouter(tags=["catalog"])

    @router.get("/catalog")
    def catalog_endpoint() -> dict:
        return {"satellites": list_satellite_ids()}

    return router

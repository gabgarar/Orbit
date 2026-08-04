"""Realtime WebSocket transport router."""

from collections.abc import Callable

from fastapi import APIRouter, WebSocket

from orbit_api.communications.realtime_session import RealtimeSession


def create_realtime_router(get_snapshot: Callable, get_orbits: Callable, compression_threshold: int) -> APIRouter:
    router = APIRouter(tags=["realtime"])

    @router.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await RealtimeSession(websocket, get_snapshot, get_orbits, compression_threshold).run()

    return router

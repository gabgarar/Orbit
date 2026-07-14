"""Lifecycle wrapper for one FastAPI realtime WebSocket connection."""

import asyncio
import json
from collections.abc import Callable

from fastapi import WebSocket, WebSocketDisconnect

from .decoder import decode_subscription_command
from .encoding import send_payload
from .subscriptions import SubscriptionState


class RealtimeSession:
    """Stream state and orbit updates for the subscriptions of one client."""

    def __init__(self, websocket: WebSocket, get_snapshot: Callable, get_orbits: Callable, compression_threshold: int):
        self._websocket = websocket
        self._get_snapshot = get_snapshot
        self._get_orbits = get_orbits
        self._compression_threshold = compression_threshold
        self._subscriptions = SubscriptionState()

    async def run(self) -> None:
        await self._websocket.accept()
        client_id = id(self._websocket)
        print(f"Cliente conectado (ID: {client_id})")
        props, _, _ = self._get_snapshot()
        await self._websocket.send_text(json.dumps({"type": "catalog", "data": [name for name, _ in props], "compressed": False}))

        receiver_task = asyncio.create_task(self._receive_commands())
        loop = asyncio.get_running_loop()
        next_state_at = next_orbit_at = 0.0
        try:
            while not receiver_task.done():
                if self._subscriptions.consume_refresh_request():
                    next_state_at = next_orbit_at = 0.0
                now = loop.time()
                props, config, by_name = self._get_snapshot()
                sent = False
                if now >= next_state_at:
                    state = []
                    for name in self._subscriptions.satellite_ids:
                        propagator = by_name.get(name)
                        if propagator is None:
                            continue
                        x, y, z, vx, vy, vz = propagator.propagate()
                        state.append({"satellite": name, "position": {"x": x, "y": y, "z": z}, "velocity": {"x": vx, "y": vy, "z": vz}})
                    await send_payload(self._websocket, {"type": "state", "data": state, "compressed": False}, self._compression_threshold)
                    next_state_at = now + config.get("websocket_state_interval_seconds", 1.0)
                    sent = True
                if config.get("orbit_future_show", True) and now >= next_orbit_at:
                    selected = [(name, by_name[name]) for name in self._subscriptions.satellite_ids if name in by_name]
                    await send_payload(self._websocket, {"type": "orbits", "data": self._get_orbits(selected, config), "compressed": False}, self._compression_threshold)
                    next_orbit_at = now + config.get("websocket_orbit_interval_seconds", 10.0)
                    sent = True
                await asyncio.sleep(0 if sent else 0.05)
        except WebSocketDisconnect:
            pass
        finally:
            receiver_task.cancel()
            print(f"Cliente desconectado (ID: {client_id})")

    async def _receive_commands(self) -> None:
        while True:
            try:
                data = await self._websocket.receive()
                if data.get("type") == "websocket.disconnect":
                    return
                raw = data.get("text") or (data["bytes"].decode() if data.get("bytes") else None)
                command = decode_subscription_command(raw)
                if command is not None:
                    self._subscriptions.apply(command)
            except (WebSocketDisconnect, RuntimeError):
                return

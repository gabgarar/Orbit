"""Transport-level serialization for realtime WebSocket messages."""

import json
import zlib

from fastapi import WebSocket


async def send_payload(websocket: WebSocket, payload: dict, compression_threshold: int) -> None:
    """Send text JSON or a smaller compressed binary payload when worthwhile."""
    json_text = json.dumps(payload)
    if len(json_text) >= compression_threshold:
        compressed = zlib.compress(json_text.encode(), level=6)
        if len(compressed) < len(json_text):
            await websocket.send_bytes(compressed)
            return
    await websocket.send_text(json_text)

# webSockets.py
import asyncio
import json
import zlib
import websockets

class WebSocketServer:

    def __init__(self, host="0.0.0.0", port=8765, state_interval=1.0, orbit_interval=10.0, 
                 compression_enabled=True, compression_threshold=1024):
        self.host = host
        self.port = port
        self.state_interval = state_interval
        self.orbit_interval = orbit_interval
        self.on_state_callback = None
        self.on_orbit_callback = None
        self.compression_enabled = compression_enabled
        self.compression_threshold = compression_threshold  # Comprimir si > X bytes
        self.client_states = {}  # Tracking de último estado por cliente para delta encoding

    def set_state_callback(self, callback):
        self.on_state_callback = callback

    def set_orbit_callback(self, callback):
        self.on_orbit_callback = callback

    def _compress_if_needed(self, json_str):
        """Comprimir datos si superan umbral y está habilitado."""
        if not self.compression_enabled or len(json_str) < self.compression_threshold:
            return json_str, False
        
        try:
            compressed = zlib.compress(json_str.encode(), level=6)
            if len(compressed) < len(json_str):
                return compressed, True
        except:
            pass
        return json_str, False

    async def handler(self, websocket):
        client_id = id(websocket)
        self.client_states[client_id] = {"last_state": None, "last_orbits": None}
        print(f"🟢 Cliente conectado (ID: {client_id})")

        try:
            loop = asyncio.get_running_loop()
            next_state_at = 0.0
            next_orbit_at = 0.0

            while True:
                now = loop.time()
                sent_message = False

                if self.on_state_callback and now >= next_state_at:
                    data = self.on_state_callback()
                    payload = {"type": "state", "data": data or [], "compressed": False}
                    
                    json_str = json.dumps(payload)
                    compressed_data, is_compressed = self._compress_if_needed(json_str)
                    
                    if is_compressed:
                        # Enviar como binary comprimido
                        await websocket.send(compressed_data)
                    else:
                        # Enviar como JSON text
                        await websocket.send(json_str)
                    
                    self.client_states[client_id]["last_state"] = data
                    next_state_at = now + self.state_interval
                    sent_message = True

                if self.on_orbit_callback and now >= next_orbit_at:
                    data = self.on_orbit_callback()
                    payload = {"type": "orbits", "data": data or [], "compressed": False}
                    
                    json_str = json.dumps(payload)
                    compressed_data, is_compressed = self._compress_if_needed(json_str)
                    
                    if is_compressed:
                        # Enviar como binary comprimido
                        await websocket.send(compressed_data)
                    else:
                        # Enviar como JSON text
                        await websocket.send(json_str)
                    
                    self.client_states[client_id]["last_orbits"] = data
                    next_orbit_at = now + self.orbit_interval
                    sent_message = True

                if sent_message:
                    await asyncio.sleep(0)
                else:
                    await asyncio.sleep(0.05)

        except websockets.exceptions.ConnectionClosed:
            print(f"🔴 Cliente desconectado (ID: {client_id})")
            del self.client_states[client_id]

    async def start(self):
        print(f"🚀 Servidor WebSocket escuchando en ws://{self.host}:{self.port}")
        print(f"   Compresión: {'activada' if self.compression_enabled else 'desactivada'}")
        async with websockets.serve(self.handler, self.host, self.port):
            await asyncio.Future()

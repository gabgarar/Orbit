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
        self.on_catalog_callback = None
        self.compression_enabled = compression_enabled
        self.compression_threshold = compression_threshold  # Comprimir si > X bytes
        self.client_states = {}  # Tracking de último estado por cliente para delta encoding

    def set_state_callback(self, callback):
        self.on_state_callback = callback

    def set_orbit_callback(self, callback):
        self.on_orbit_callback = callback

    def set_catalog_callback(self, callback):
        self.on_catalog_callback = callback

    async def _receiver_loop(self, websocket, client_id):
        while True:
            raw = await websocket.recv()
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            if not isinstance(msg, dict):
                continue

            msg_type = msg.get("type")
            ids = msg.get("ids")
            if not isinstance(ids, list):
                ids = []

            clean_ids = [str(x) for x in ids if isinstance(x, str)]
            client_state = self.client_states.get(client_id, {})
            subscriptions = client_state.get("subscriptions")
            if subscriptions is None:
                continue

            if msg_type == "subscribe":
                subscriptions.update(clean_ids)
                client_state["force_refresh"] = True
            elif msg_type == "unsubscribe":
                for sat_id in clean_ids:
                    subscriptions.discard(sat_id)
                client_state["force_refresh"] = True
            elif msg_type == "set_subscriptions":
                subscriptions.clear()
                subscriptions.update(clean_ids)
                client_state["force_refresh"] = True

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
        self.client_states[client_id] = {
            "last_state": None,
            "last_orbits": None,
            "subscriptions": set(),
            "force_refresh": False,
        }
        print(f"🟢 Cliente conectado (ID: {client_id})")

        try:
            if self.on_catalog_callback:
                catalog = self.on_catalog_callback() or []
                payload = {"type": "catalog", "data": catalog, "compressed": False}
                await websocket.send(json.dumps(payload))

            loop = asyncio.get_running_loop()
            next_state_at = 0.0
            next_orbit_at = 0.0
            receiver_task = asyncio.create_task(self._receiver_loop(websocket, client_id))

            while True:
                now = loop.time()
                sent_message = False
                client_state = self.client_states.get(client_id, {})
                subscriptions = client_state.get("subscriptions", set())

                if client_state.get("force_refresh"):
                    next_state_at = 0.0
                    next_orbit_at = 0.0
                    client_state["force_refresh"] = False

                if self.on_state_callback and now >= next_state_at:
                    data = self.on_state_callback(client_id, subscriptions)
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
                    data = self.on_orbit_callback(client_id, subscriptions)
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
        finally:
            try:
                receiver_task.cancel()
            except Exception:
                pass
            if client_id in self.client_states:
                del self.client_states[client_id]

    async def start(self):
        print(f"🚀 Servidor WebSocket escuchando en ws://{self.host}:{self.port}")
        print(f"   Compresión: {'activada' if self.compression_enabled else 'desactivada'}")
        async with websockets.serve(self.handler, self.host, self.port):
            await asyncio.Future()

# webSockets.py
import asyncio
import websockets
import json

class WebSocketServer:

    def __init__(self, host="0.0.0.0", port=8765):
        self.host = host
        self.port = port
        self.on_tick_callback = None

    def set_tick_callback(self, callback):
        self.on_tick_callback = callback

    async def handler(self, websocket):
        print("Cliente conectado")

        try:
            while True:
                if self.on_tick_callback:
                    data = self.on_tick_callback()
                    if data:
                        await websocket.send(json.dumps(data))
                await asyncio.sleep(1)

        except websockets.exceptions.ConnectionClosed:
            print("Cliente desconectado")

    async def start(self):
        print(f"Servidor WebSocket escuchando en ws://{self.host}:{self.port}")
        async with websockets.serve(self.handler, self.host, self.port):
            await asyncio.Future()

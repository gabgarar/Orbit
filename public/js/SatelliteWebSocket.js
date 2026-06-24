export class SatelliteWebSocket {

    constructor(onMessageCallback) {
        const host = window.location.hostname.replace("-8100", "-8765");
        this.url = `wss://${host}`;
        this.onMessageCallback = onMessageCallback;
        this.ws = null;
    }

    connect() {
        console.log(`📡 Conectando WebSocket a ${this.url}...`);

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => console.log("🟢 WebSocket conectado");
        this.ws.onclose = () => console.warn("🔴 WebSocket desconectado");
        this.ws.onerror = (err) => console.error("⚠️ Error en WebSocket:", err);

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.onMessageCallback(data);
            } catch (e) {
                console.error("❌ Error procesando mensaje WS:", e);
            }
        };
    }
}

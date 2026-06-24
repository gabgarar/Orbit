import { getLogger } from "./logger.js";

const logger = getLogger("ws");

export class SatelliteWebSocket {

    constructor(onMessageCallback) {
        const host = window.location.hostname.replace("-8100", "-8765");
        this.url = `wss://${host}`;
        this.onMessageCallback = onMessageCallback;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // ms
    }

    connect() {
        logger.info(`Conectando WebSocket a ${this.url}...`);

        this.ws = new WebSocket(this.url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            logger.info("WebSocket conectado");
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
        };

        this.ws.onclose = () => {
            logger.warn("WebSocket desconectado");
            this._attemptReconnect();
        };

        this.ws.onerror = (err) => logger.error("Error en WebSocket:", err);

        this.ws.onmessage = async (event) => {
            try {
                let data;

                // Detectar si es datos binarios (comprimidos) o texto (JSON)
                if (event.data instanceof ArrayBuffer) {
                    // Datos comprimidos en binary
                    const decompressed = await this._decompress(new Uint8Array(event.data));
                    data = JSON.parse(decompressed);
                } else if (event.data instanceof Blob) {
                    // Fallback para navegadores que entregan Blob en mensajes binarios
                    const arrayBuffer = await event.data.arrayBuffer();
                    const decompressed = await this._decompress(new Uint8Array(arrayBuffer));
                    data = JSON.parse(decompressed);
                } else if (typeof event.data === 'string') {
                    // JSON normal en texto
                    data = JSON.parse(event.data);
                } else {
                    logger.warn("Tipo de dato inesperado en WebSocket:", typeof event.data);
                    return;
                }

                this.onMessageCallback(data);
            } catch (e) {
                logger.error("Error procesando mensaje WS:", e);
            }
        };
    }

    _attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error("Máximo de intentos de reconexión alcanzado");
            return;
        }

        this.reconnectAttempts++;
        logger.info(`Reconectando en ${this.reconnectDelay}ms (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);

        // Exponential backoff: duplicar delay cada vez
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }

    async _decompress(buffer) {
        /**
         * Descomprimir datos usando DecompressionStream (si disponible)
         * o fallback a pako.js
         */
        // Intentar con DecompressionStream nativa
        try {
            if ('DecompressionStream' in window) {
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(buffer);
                        controller.close();
                    }
                });
                
                const decompressedStream = stream.pipeThrough(
                    new DecompressionStream('deflate')
                );
                
                const reader = decompressedStream.getReader();
                const chunks = [];
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
                
                // Combinar chunks en un solo Uint8Array
                const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const decompressed = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    decompressed.set(chunk, offset);
                    offset += chunk.length;
                }
                
                return new TextDecoder().decode(decompressed);
            }
        } catch (e) {
            logger.debug("DecompressionStream no disponible, usando pako:", e);
        }

        // Fallback: usar pako
        try {
            // Cargar pako dinámicamente si no está disponible
            if (!window.pako) {
                const pakoModule = await import('https://cdn.jsdelivr.net/npm/pako@2/dist/pako.es5.min.js');
                window.pako = pakoModule.default || pakoModule;
            }
            
            const inflated = window.pako.inflate(buffer);
            return new TextDecoder().decode(inflated);
        } catch (e) {
            logger.error("Error descomprimiendo con pako:", e);
            throw new Error("No se pudo descomprimir datos: " + e.message);
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}

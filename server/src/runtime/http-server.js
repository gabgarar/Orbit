import http from "node:http";
import https from "node:https";

const WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 10_000;

function writeRawResponse(socket, {
    httpVersion = "1.1",
    statusCode,
    statusMessage,
    rawHeaders = []
}) {
    const lines = [`HTTP/${httpVersion} ${statusCode} ${statusMessage || ""}`.trim()];
    for (let index = 0; index < rawHeaders.length; index += 2) {
        lines.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
}

function closeUpgrade(socket, statusCode, statusMessage) {
    if (socket.destroyed) return;
    // An already-disconnected raw upgrade socket can fail while writing the
    // fallback HTTP response. Consume that terminal error instead of letting
    // it become an unhandled socket event.
    socket.once("error", () => {});
    writeRawResponse(socket, { statusCode, statusMessage, rawHeaders: ["Connection", "close"] });
    socket.end();
}

function websocketTarget(backendUrl, requestUrl) {
    if (!backendUrl) return null;
    try {
        const request = new URL(requestUrl || "/ws", "http://orbit.local");
        if (request.pathname !== "/ws") return null;
        const backend = new URL(backendUrl);
        if (backend.protocol !== "http:" && backend.protocol !== "https:") return null;
        return new URL(`${request.pathname}${request.search}`, backend.origin);
    } catch {
        return null;
    }
}

function resolveHandshakeTimeout(value) {
    const timeoutMs = Number(value);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : WEBSOCKET_HANDSHAKE_TIMEOUT_MS;
}

function finishHandshake(handshake, handshakes) {
    if (handshake.finished) return false;
    handshake.finished = true;
    handshakes.delete(handshake);
    if (handshake.timeout !== null) clearTimeout(handshake.timeout);
    handshake.clientSocket.off("close", handshake.onClientClose);
    handshake.clientSocket.off("error", handshake.onClientError);
    return true;
}

function abortHandshake(handshake, handshakes, { destroyClient = true } = {}) {
    if (!finishHandshake(handshake, handshakes)) return false;
    handshake.upstreamRequest?.destroy();
    handshake.upstreamSocket?.destroy();
    if (destroyClient && !handshake.clientSocket.destroyed) handshake.clientSocket.destroy();
    return true;
}

function trackHandshake({ clientSocket, handshakes, timeoutMs, logger }) {
    const handshake = {
        clientSocket,
        upstreamRequest: null,
        upstreamSocket: null,
        timeout: null,
        finished: false,
        onClientClose: null,
        onClientError: null
    };
    handshake.onClientClose = () => abortHandshake(handshake, handshakes, { destroyClient: false });
    handshake.onClientError = () => abortHandshake(handshake, handshakes, { destroyClient: false });
    clientSocket.once("close", handshake.onClientClose);
    clientSocket.once("error", handshake.onClientError);
    handshakes.add(handshake);
    handshake.timeout = setTimeout(() => {
        if (!abortHandshake(handshake, handshakes, { destroyClient: false })) return;
        logger.warn("Orbit WebSocket handshake timed out.");
        closeUpgrade(clientSocket, 504, "Gateway Timeout");
    }, timeoutMs);
    return handshake;
}

function wireSockets(clientSocket, upstreamSocket, sockets) {
    const release = (socket) => {
        sockets.delete(socket);
        if (!clientSocket.destroyed) clientSocket.destroy();
        if (!upstreamSocket.destroyed) upstreamSocket.destroy();
    };
    sockets.add(clientSocket);
    sockets.add(upstreamSocket);
    clientSocket.once("close", () => release(clientSocket));
    upstreamSocket.once("close", () => release(upstreamSocket));
    clientSocket.once("error", () => release(clientSocket));
    upstreamSocket.once("error", () => release(upstreamSocket));
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
}

function proxyWebSocketUpgrade({ request, socket, head, pythonBackendUrl, sockets, handshakes, handshakeTimeoutMs, logger }) {
    const target = websocketTarget(pythonBackendUrl, request.url);
    if (!target) {
        closeUpgrade(socket, 404, "Not Found");
        return;
    }
    if (String(request.headers.upgrade || "").toLowerCase() !== "websocket") {
        closeUpgrade(socket, 400, "WebSocket Upgrade Required");
        return;
    }

    const transport = target.protocol === "https:" ? https : http;
    const handshake = trackHandshake({
        clientSocket: socket,
        handshakes,
        timeoutMs: handshakeTimeoutMs,
        logger
    });
    let upstreamRequest;

    try {
        upstreamRequest = transport.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || undefined,
            method: "GET",
            path: `${target.pathname}${target.search}`,
            headers: {
                ...request.headers,
                host: target.host,
                connection: "Upgrade",
                upgrade: "websocket"
            }
        });
    } catch (error) {
        if (finishHandshake(handshake, handshakes)) {
            logger.warn("Unable to proxy Orbit WebSocket:", error.message);
            closeUpgrade(socket, 502, "Bad Gateway");
        }
        return;
    }
    handshake.upstreamRequest = upstreamRequest;

    upstreamRequest.once("upgrade", (response, upstreamSocket, upstreamHead) => {
        handshake.upstreamSocket = upstreamSocket;
        if (!finishHandshake(handshake, handshakes) || socket.destroyed) {
            upstreamSocket.destroy();
            return;
        }
        writeRawResponse(socket, response);
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) upstreamSocket.write(head);
        wireSockets(socket, upstreamSocket, sockets);
    });
    upstreamRequest.once("response", (response) => {
        if (!finishHandshake(handshake, handshakes) || socket.destroyed) {
            response.destroy();
            return;
        }
        writeRawResponse(socket, response);
        response.pipe(socket);
    });
    upstreamRequest.once("error", (error) => {
        if (!finishHandshake(handshake, handshakes) || socket.destroyed) return;
        logger.warn("Unable to proxy Orbit WebSocket:", error.message);
        closeUpgrade(socket, 502, "Bad Gateway");
    });
    upstreamRequest.end();
}

export async function startHttpServer({
    app,
    port,
    pythonBackendUrl,
    logger = console,
    websocketHandshakeTimeoutMs = WEBSOCKET_HANDSHAKE_TIMEOUT_MS
}) {
    const server = http.createServer(app);
    const websocketSockets = new Set();
    const pendingWebSocketHandshakes = new Set();
    const handshakeTimeoutMs = resolveHandshakeTimeout(websocketHandshakeTimeoutMs);
    server.on("upgrade", (request, socket, head) => {
        proxyWebSocketUpgrade({
            request,
            socket,
            head,
            pythonBackendUrl,
            sockets: websocketSockets,
            handshakes: pendingWebSocketHandshakes,
            handshakeTimeoutMs,
            logger
        });
    });

    await new Promise((resolve, reject) => {
        const fail = (error) => {
            server.off("listening", ready);
            reject(error);
        };
        const ready = () => {
            server.off("error", fail);
            resolve();
        };
        server.once("error", fail);
        server.once("listening", ready);
        server.listen(port);
    });
    logger.log(`Orbit web server listening on http://localhost:${port}`);

    let closed = false;
    async function close() {
        if (closed) return;
        closed = true;
        for (const handshake of pendingWebSocketHandshakes) {
            abortHandshake(handshake, pendingWebSocketHandshakes);
        }
        pendingWebSocketHandshakes.clear();
        for (const socket of websocketSockets) socket.destroy();
        websocketSockets.clear();
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
    return { server, close };
}

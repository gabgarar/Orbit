import express from "express";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { startHttpServer } from "../../src/runtime/http-server.js";

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    return address.port;
}

async function close(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function waitForSocketData(socket, predicate) {
    return new Promise((resolve, reject) => {
        let received = Buffer.alloc(0);
        const timeout = setTimeout(() => finish(new Error("Timed out waiting for socket data.")), 2_000);
        const onData = (chunk) => {
            received = Buffer.concat([received, chunk]);
            if (predicate(received)) finish(null, received);
        };
        const onError = (error) => finish(error);
        const onClose = () => finish(new Error("Socket closed before returning the expected data."));
        const finish = (error, value) => {
            clearTimeout(timeout);
            socket.off("data", onData);
            socket.off("error", onError);
            socket.off("close", onClose);
            if (error) reject(error);
            else resolve(value);
        };
        socket.on("data", onData);
        socket.once("error", onError);
        socket.once("close", onClose);
    });
}

function within(promise, timeoutMs, description) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out: ${description}`)), timeoutMs);
        Promise.resolve(promise).then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}

function writeWebSocketUpgrade(socket, port) {
    socket.write([
        "GET /ws HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: test-key",
        "",
        ""
    ].join("\r\n"));
}

test("HTTP runtime starts on an ephemeral port and closes idempotently", async () => {
    const app = express();
    app.get("/", (_request, response) => response.send("ok"));
    const logs = [];
    const runtime = await startHttpServer({ app, port: 0, logger: { log: (message) => logs.push(message) } });
    try {
        const address = runtime.server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/`);
        assert.equal(await response.text(), "ok");
        assert.equal(logs.length, 1);
    } finally {
        await runtime.close();
        await runtime.close();
    }
});

test("HTTP runtime proxies same-origin WebSocket upgrades to the Python backend", async () => {
    let upstreamRequest;
    const backend = http.createServer();
    backend.on("upgrade", (request, socket) => {
        upstreamRequest = { url: request.url, host: request.headers.host };
        socket.write([
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: test-accept",
            "",
            ""
        ].join("\r\n"));
        socket.on("data", (chunk) => socket.write(chunk));
        // A real WebSocket server closes its writable side after a peer
        // disconnects; mirror that lifecycle so the test server can stop.
        socket.on("end", () => socket.end());
    });
    const backendPort = await listen(backend);
    const app = express();
    const runtime = await startHttpServer({
        app,
        port: 0,
        pythonBackendUrl: `http://127.0.0.1:${backendPort}`,
        logger: { log: () => {}, warn: () => {} }
    });
    const gatewayPort = runtime.server.address().port;
    const socket = net.createConnection({ host: "127.0.0.1", port: gatewayPort });

    try {
        await once(socket, "connect");
        const upgraded = waitForSocketData(socket, (data) => data.includes(Buffer.from("\r\n\r\n")));
        socket.write([
            "GET /ws?channel=state HTTP/1.1",
            `Host: 127.0.0.1:${gatewayPort}`,
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: test-key",
            "",
            ""
        ].join("\r\n"));
        const response = await upgraded;

        assert.match(response.toString(), /^HTTP\/1\.1 101 Switching Protocols/);
        assert.deepEqual(upstreamRequest, {
            url: "/ws?channel=state",
            host: `127.0.0.1:${backendPort}`
        });

        const echoed = waitForSocketData(socket, (data) => data.includes(Buffer.from("relay-payload")));
        socket.write("relay-payload");
        assert.match((await echoed).toString(), /relay-payload/);
    } finally {
        socket.destroy();
        await runtime.close();
        await close(backend);
    }
});

test("HTTP runtime closes a WebSocket handshake stalled by the Python backend", async () => {
    let acknowledgeUpgrade;
    const receivedUpgrade = new Promise((resolve) => { acknowledgeUpgrade = resolve; });
    const backendSockets = new Set();
    const backend = http.createServer();
    backend.on("connection", (socket) => {
        backendSockets.add(socket);
        socket.once("close", () => backendSockets.delete(socket));
    });
    backend.on("upgrade", () => acknowledgeUpgrade());
    const backendPort = await listen(backend);
    const runtime = await startHttpServer({
        app: express(),
        port: 0,
        pythonBackendUrl: `http://127.0.0.1:${backendPort}`,
        logger: { log: () => {}, warn: () => {} }
    });
    const gatewayPort = runtime.server.address().port;
    const socket = net.createConnection({ host: "127.0.0.1", port: gatewayPort });

    try {
        await once(socket, "connect");
        writeWebSocketUpgrade(socket, gatewayPort);
        await within(receivedUpgrade, 1_000, "backend WebSocket upgrade request");

        await assert.doesNotReject(
            within(runtime.close(), 500, "gateway shutdown with a pending WebSocket handshake")
        );
        assert.equal(runtime.server.listening, false);
    } finally {
        socket.destroy();
        await runtime.close();
        for (const backendSocket of backendSockets) backendSocket.destroy();
        await close(backend);
    }
});

test("HTTP runtime times out a WebSocket handshake that receives no backend response", async () => {
    const backendSockets = new Set();
    const backend = http.createServer();
    backend.on("connection", (socket) => {
        backendSockets.add(socket);
        socket.once("close", () => backendSockets.delete(socket));
    });
    backend.on("upgrade", () => {});
    const backendPort = await listen(backend);
    const warnings = [];
    const runtime = await startHttpServer({
        app: express(),
        port: 0,
        pythonBackendUrl: `http://127.0.0.1:${backendPort}`,
        websocketHandshakeTimeoutMs: 50,
        logger: { log: () => {}, warn: (message) => warnings.push(message) }
    });
    const gatewayPort = runtime.server.address().port;
    const socket = net.createConnection({ host: "127.0.0.1", port: gatewayPort });

    try {
        await once(socket, "connect");
        const response = waitForSocketData(socket, (data) => data.includes(Buffer.from("\r\n\r\n")));
        writeWebSocketUpgrade(socket, gatewayPort);

        assert.match((await response).toString(), /^HTTP\/1\.1 504 Gateway Timeout/);
        assert.deepEqual(warnings, ["Orbit WebSocket handshake timed out."]);
    } finally {
        socket.destroy();
        await runtime.close();
        for (const backendSocket of backendSockets) backendSocket.destroy();
        await close(backend);
    }
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveSatelliteWebSocketUrl } from "../../js/SatelliteWebSocket.js";

test("satellite WebSocket uses the application origin and preserves its HTTP port", () => {
    assert.equal(
        resolveSatelliteWebSocketUrl({ protocol: "http:", host: "localhost:8123" }),
        "ws://localhost:8123/ws"
    );
});

test("satellite WebSocket upgrades to WSS when Orbit is served over HTTPS", () => {
    assert.equal(
        resolveSatelliteWebSocketUrl({ protocol: "https:", host: "orbit.example.test" }),
        "wss://orbit.example.test/ws"
    );
});

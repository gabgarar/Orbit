import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createPythonForwarder } from "../../src/proxy/forwarder.js";

test("a disconnected browser aborts the corresponding private Python calculation", async () => {
    const request = Object.assign(new EventEmitter(), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        query: {},
        body: { name: "Manual orbit" },
        aborted: false
    });
    const response = Object.assign(new EventEmitter(), {
        writableEnded: false,
        destroyed: false
    });
    let upstreamSignal = null;
    let signalObserved;
    const observed = new Promise((resolve) => {
        signalObserved = resolve;
    });
    const client = {
        request: async (_path, options) => {
            upstreamSignal = options.signal;
            signalObserved();
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener("abort", () => {
                    const error = new Error("request cancelled by client");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        }
    };

    const forward = createPythonForwarder(client, { timeoutMs: 0 });
    const pending = forward(request, response, "/manual-orbits");
    await observed;
    response.emit("close");
    await pending;

    assert.ok(upstreamSignal, "the gateway must pass a cancellation signal downstream");
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(response.listenerCount("close"), 0, "the bridge must dispose its response listener");
    assert.equal(request.listenerCount("aborted"), 0, "the bridge must dispose its request listener");
});

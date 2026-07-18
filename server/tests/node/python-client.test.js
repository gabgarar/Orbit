import test from "node:test";
import assert from "node:assert/strict";
import { createPythonClient } from "../../src/proxy/client.js";

test("Python client forwards requests and clears a valid timeout", async () => {
    const calls = [];
    const clearedTimers = [];
    const client = createPythonClient("http://python.internal:8765", {
        fetchImpl: async (url, options) => {
            calls.push({ url: url.toString(), options });
            return new Response("ok", { status: 201 });
        },
        setTimeoutImpl: (_callback, delay) => ({ delay }),
        clearTimeoutImpl: (timer) => { clearedTimers.push(timer); }
    });

    const response = await client.request("/propagate?norad=25544", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: "{}",
        timeoutMs: 500
    });

    assert.equal(response.status, 201);
    assert.equal(calls[0].url, "http://python.internal:8765/propagate?norad=25544");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body, "{}");
    assert.deepEqual(clearedTimers, [{ delay: 500 }]);
});

test("Python client ignores invalid timeout values instead of scheduling immediate aborts", async () => {
    const scheduledTimers = [];
    const client = createPythonClient("http://python.internal:8765", {
        fetchImpl: async () => new Response("ok", { status: 200 }),
        setTimeoutImpl: (_callback, delay) => { scheduledTimers.push(delay); return delay; }
    });

    await client.request("/health", { timeoutMs: Infinity });
    await client.request("/health", { timeoutMs: -1 });
    await client.request("/health", { timeoutMs: 0 });

    assert.deepEqual(scheduledTimers, []);
});

test("Python client combines an external abort signal with its request timeout", async () => {
    const timers = [];
    const clearedTimers = [];
    const controller = new AbortController();
    let requestSignal;
    const client = createPythonClient("http://python.internal:8765", {
        fetchImpl: async (_url, { signal }) => {
            requestSignal = signal;
            return new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
        },
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        clearTimeoutImpl: (timer) => { clearedTimers.push(timer); }
    });

    const request = client.request("/reload", { method: "POST", signal: controller.signal, timeoutMs: 500 });
    const cancellation = new Error("reload cancelled");
    controller.abort(cancellation);

    await assert.rejects(request, cancellation);
    assert.notEqual(requestSignal, controller.signal);
    assert.equal(requestSignal.aborted, true);
    assert.deepEqual(timers.map((timer) => timer.delay), [500]);
    assert.deepEqual(clearedTimers, timers);
});

test("Python client health checks return false when the backend is unreachable", async () => {
    const unavailable = createPythonClient("http://python.internal:8765", {
        fetchImpl: async () => { throw new Error("connection refused"); }
    });
    const unhealthyResponse = createPythonClient("http://python.internal:8765", {
        fetchImpl: async () => new Response("not ready", { status: 503 })
    });

    assert.equal(await unavailable.isHealthy(), false);
    assert.equal(await unhealthyResponse.isHealthy(), false);
});

test("Python client only accepts an origin-only backend URL and cannot escape it", async () => {
    for (const invalidUrl of [
        "http://python.internal:8765/api",
        "http://python.internal:8765/?token=secret",
        "http://user:secret@python.internal:8765/"
    ]) {
        assert.throws(() => createPythonClient(invalidUrl), /HTTP\(S\) origin/);
    }

    const client = createPythonClient("http://python.internal:8765", {
        fetchImpl: async () => new Response("ok", { status: 200 })
    });
    await assert.rejects(
        client.request("https://untrusted.example/health"),
        /must remain on the configured backend origin/
    );
});

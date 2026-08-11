import assert from "node:assert/strict";
import test from "node:test";

import {
    fetchPreciseProductPreview
} from "../../js/features/preciseProducts/previewRequest.js";

test("GNSS preview request returns the parsed non-persistent response", async () => {
    let received = null;
    const payload = await fetchPreciseProductPreview({ sp3: { name: "test.SP3" } }, {
        fetchImpl: async (url, options) => {
            received = { url, options };
            return {
                ok: true,
                json: async () => ({ ok: true, preview: { satellites: [] } })
            };
        },
        setTimeoutImpl: () => 1,
        clearTimeoutImpl: () => {}
    });

    assert.equal(received.url, "/api/precise-products/preview");
    assert.equal(received.options.method, "POST");
    assert.deepEqual(JSON.parse(received.options.body), { sp3: { name: "test.SP3" } });
    assert.deepEqual(payload, { ok: true, preview: { satellites: [] } });
});

test("GNSS preview request turns a stalled service into a recoverable timeout", async () => {
    let triggerTimeout;
    let timerCleared = false;

    await assert.rejects(
        () => fetchPreciseProductPreview({ sp3: { name: "test.SP3" } }, {
            fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
                options.signal.addEventListener("abort", () => {
                    const error = new Error("aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
                triggerTimeout();
            }),
            timeoutMs: 1,
            setTimeoutImpl: (callback) => {
                triggerTimeout = callback;
                return 17;
            },
            clearTimeoutImpl: (timer) => {
                assert.equal(timer, 17);
                timerCleared = true;
            }
        }),
        /análisis del producto GNSS tardó demasiado/
    );

    assert.equal(timerCleared, true);
});

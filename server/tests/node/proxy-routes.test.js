import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { PYTHON_PROXY_TIMEOUT_MS } from "../../src/proxy/forwarder.js";
import { registerPythonProxyRoutes } from "../../src/proxy/routes.js";

async function withServer(app, callback) {
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
        const { port } = server.address();
        return await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

function createProxyApp(request) {
    const app = express();
    app.use(express.json());
    registerPythonProxyRoutes(app, { request });
    return app;
}

test("proxy forwards query parameters, including repeated values", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response("{}", { headers: { "content-type": "application/json" } });
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/orbits?operator=ESA&tag=leo&tag=active`);
        assert.equal(response.status, 200);
    });

    assert.equal(calls.length, 1);
    const target = new URL(calls[0].path, "http://proxy.invalid/");
    assert.equal(target.pathname, "/orbits");
    assert.deepEqual([...target.searchParams.entries()], [
        ["operator", "ESA"],
        ["tag", "leo"],
        ["tag", "active"]
    ]);
    assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[0].options.timeoutMs, PYTHON_PROXY_TIMEOUT_MS);
});

test("proxy forwards POST method, JSON body, and accepted content headers", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response("{}", { headers: { "content-type": "application/json" } });
    });
    const payload = { norad_id: 25544, duration_minutes: 90 };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/propagate`, {
            method: "POST",
            headers: {
                accept: "application/geo+json",
                "content-type": "application/json",
                "x-not-forwarded": "local-only"
            },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.deepEqual(calls, [{
        path: "/propagate",
        options: {
            method: "POST",
            headers: {
                Accept: "application/geo+json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            timeoutMs: PYTHON_PROXY_TIMEOUT_MS
        }
    }]);
});

test("proxy preserves upstream status and content type", async () => {
    const app = createProxyApp(async () => new Response("<html>docs</html>", {
        status: 207,
        headers: { "content-type": "text/html; charset=utf-8" }
    }));

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/docs/reference`);
        assert.equal(response.status, 207);
        assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(await response.text(), "<html>docs</html>");
    });
});

test("proxy returns a 502 response when the Python service fails", async () => {
    const app = createProxyApp(async () => {
        throw new Error("Python backend unavailable");
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ephemeris`);
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), {
            ok: false,
            error: "Python backend unavailable"
        });
    });
});

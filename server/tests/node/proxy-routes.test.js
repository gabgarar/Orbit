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

test("proxy exposes the transient manual-orbits endpoint", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response("{\"name\":\"Manual orbit\"}", { headers: { "content-type": "application/json" } });
    });
    const payload = {
        name: "Manual orbit",
        epochUtc: "2026-07-20T12:00:00Z",
        propagator: "sgp4",
        keplerian: { semiMajorAxisKm: 6878, eccentricity: 0.001 }
    };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/manual-orbits`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/manual-orbits");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body, JSON.stringify(payload));
});

test("proxy exposes the manual ephemeris export POST route without losing its format query", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response("time,x,y,z\n", { headers: { "content-type": "text/csv" } });
    });
    const payload = { name: "Manual orbit", epoch: "2026-07-20T12:00:00Z", propagator: "two-body" };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/export/manual-ephemeris?format=geojson`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/geo+json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.deepEqual(calls, [{
        path: "/export/manual-ephemeris?format=geojson",
        options: {
            method: "POST",
            headers: { Accept: "application/geo+json", "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: PYTHON_PROXY_TIMEOUT_MS
        }
    }]);
});

test("proxy exposes the propagated orbit-parameters endpoint", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response("{\"samples\":[]}", { headers: { "content-type": "application/json" } });
    });
    const payload = {
        source: { type: "catalog", satId: "ISS" },
        startTime: "2026-07-20T12:00:00Z",
        endTime: "2026-07-20T13:00:00Z",
        samples: 25
    };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/orbit-parameters`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/orbit-parameters");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.body, JSON.stringify(payload));
});

test("proxy exposes the binary ground-station GeoPackage export endpoint", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response(new Uint8Array([0x53, 0x51, 0x4c]), {
            headers: {
                "content-type": "application/geopackage+sqlite3",
                "content-disposition": "attachment; filename=orbit-ground-stations.gpkg"
            }
        });
    });
    const payload = {
        format: "gpkg",
        stations: [{ name: "Madrid", latitude_deg: 40.4, longitude_deg: -3.7 }]
    };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ground-stations/export`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-disposition"), "attachment; filename=orbit-ground-stations.gpkg");
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0x53, 0x51, 0x4c]);
    });

    assert.deepEqual(calls, [{
        path: "/ground-stations/export",
        options: {
            method: "POST",
            headers: { Accept: "*/*", "Content-Type": "application/json" },
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

test("proxy preserves binary spatial exports and their download filename", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80]);
    const app = createProxyApp(async () => new Response(bytes, {
        status: 200,
        headers: {
            "content-type": "application/vnd.google-earth.kmz",
            "content-disposition": "attachment; filename=orbit.kmz"
        }
    }));

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ephemeris`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/vnd.google-earth.kmz");
        assert.equal(response.headers.get("content-disposition"), "attachment; filename=orbit.kmz");
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
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

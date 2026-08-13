import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { PYTHON_PROXY_TIMEOUT_MS } from "../../src/proxy/forwarder.js";
import {
    MANUAL_ERP_PREVIEW_JSON_LIMIT,
    registerManualOrbitErpBodyParser,
    registerManualOrbitErpPreviewProxyRoute,
    PRECISE_PRODUCT_IMPORT_JSON_LIMIT,
    registerPreciseProductImportBodyParser,
    registerPreciseProductImportProxyRoute,
    registerPythonProxyRoutes
} from "../../src/proxy/routes.js";

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
    // Match production ordering: the bounded large-product parser must run
    // before the normal JSON parser.
    registerPreciseProductImportBodyParser(app);
    registerPreciseProductImportProxyRoute(app, { request });
    registerManualOrbitErpBodyParser(app);
    registerManualOrbitErpPreviewProxyRoute(app, { request });
    app.use(express.json({ limit: "25mb" }));
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

test("proxy forwards a manually uploaded ERP only through its bounded preview route", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    });
    const payload = {
        manualErp: {
            name: "IGS0OPSFIN_20262220000_01D_ERP.ERP.gz",
            contentBase64: "RVJQ"
        },
        designWindow: {
            startTime: "2026-08-01T00:00:00Z",
            endTime: "2026-08-02T00:00:00Z"
        }
    };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/manual-orbits/time/erp-preview`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.equal(MANUAL_ERP_PREVIEW_JSON_LIMIT, "50mb");
    assert.deepEqual(calls, [{
        path: "/manual-orbits/time/erp-preview",
        options: {
            method: "POST",
            headers: { Accept: "*/*", "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: PYTHON_PROXY_TIMEOUT_MS
        }
    }]);
});

test("proxy forwards paired precise-product uploads through the dedicated bounded route", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response('{"ok":true,"satellites":[]}', { headers: { "content-type": "application/json" } });
    });
    const payload = {
        files: [
            { name: "IGS0OPSFIN_20262220000_01D_05M_ORB.SP3.gz", content_base64: "U1Az" },
            { name: "IGS0OPSFIN_20262220000_01D_30S_CLK.CLK.gz", content_base64: "Q0xL" }
        ],
        provider_hint: "cddis-igs",
        product_class: "final"
    };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/precise-products/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.equal(PRECISE_PRODUCT_IMPORT_JSON_LIMIT, "90mb");
    assert.deepEqual(calls, [{
        path: "/precise-products/import",
        options: {
            method: "POST",
            headers: { Accept: "*/*", "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: PYTHON_PROXY_TIMEOUT_MS
        }
    }]);
});

test("proxy forwards non-persistent precise-product previews through the same bounded route", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response('{"ok":true,"preview":{"satellites":[]}}', {
            headers: { "content-type": "application/json" }
        });
    });
    const payload = {
        sp3: { name: "IGS0OPSFIN_20262220000_01D_05M_ORB.SP3.gz", content_base64: "U1Az" }
    };

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/precise-products/preview`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        assert.equal(response.status, 200);
    });

    assert.deepEqual(calls, [{
        path: "/precise-products/preview",
        options: {
            method: "POST",
            headers: { Accept: "*/*", "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            timeoutMs: PYTHON_PROXY_TIMEOUT_MS
        }
    }]);
});

test("the precise upload parser does not widen normal API JSON limits", async () => {
    const calls = [];
    const request = async (path, options) => {
        calls.push({ path, options });
        return new Response("{}", { headers: { "content-type": "application/json" } });
    };
    const app = express();
    registerPreciseProductImportBodyParser(app);
    registerPreciseProductImportProxyRoute(app, { request });
    registerManualOrbitErpBodyParser(app);
    registerManualOrbitErpPreviewProxyRoute(app, { request });
    // A deliberately small generic limit proves that the high upload limit
    // remains isolated to /api/precise-products/import.
    app.use(express.json({ limit: "256b" }));
    registerPythonProxyRoutes(app, { request });
    // Keep the expected 413 out of the test runner's stderr while retaining
    // the same observable HTTP contract as Orbit's API error handler.
    app.use((error, _request, response, next) => {
        if (error?.type === "entity.too.large") {
            response.status(413).json({ error: "request entity too large" });
            return;
        }
        next(error);
    });
    const body = JSON.stringify({ files: [{ name: "demo.sp3", content_base64: "A".repeat(1024) }] });

    await withServer(app, async (baseUrl) => {
        const preciseResponse = await fetch(`${baseUrl}/api/precise-products/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
        });
        assert.equal(preciseResponse.status, 200);

        const ordinaryResponse = await fetch(`${baseUrl}/api/propagate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payload: "x".repeat(1024) })
        });
        assert.equal(ordinaryResponse.status, 413);

        const manualOrbitResponse = await fetch(`${baseUrl}/api/manual-orbits`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payload: "x".repeat(1024) })
        });
        assert.equal(manualOrbitResponse.status, 413);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/precise-products/import");
});

test("proxy exposes persisted precise-product metadata for startup hydration", async () => {
    const calls = [];
    const app = createProxyApp(async (path, options) => {
        calls.push({ path, options });
        return new Response('{"items":[]}', { headers: { "content-type": "application/json" } });
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/precise-products`);
        assert.equal(response.status, 200);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/precise-products");
    assert.equal(calls[0].options.body, undefined);
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

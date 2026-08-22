import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createOrbitApp } from "../../src/app.js";

function dependencies(isHealthy, overrides = {}) {
    return {
        runtime: {
            reactDistDir: ".",
            frontDir: path.resolve("..", "front"),
            configDir: ".",
            docsSiteDir: path.resolve("..", "docs-site")
        },
        config: { get: async () => ({ system: {}, data: {} }), save: async () => {} },
        catalog: { get: async () => ({ entries: [] }) },
        importer: { importContent: async () => ({ ok: true }) },
        refresher: { refresh: async () => ({ ok: true }), schedule: async () => {} },
        pythonBackend: { isHealthy, reload: async () => true },
        pythonClient: { request: async () => new Response("{}", { status: 200 }) },
        ...overrides
    };
}

async function withApp(app, callback) {
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
        const address = server.address();
        return await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

test("health endpoint reflects Python backend readiness", async () => {
    const readyApp = createOrbitApp(dependencies(async () => true));
    await withApp(readyApp, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "ok", python_backend: "ok" });
    });

    const waitingApp = createOrbitApp(dependencies(async () => false));
    await withApp(waitingApp, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: "starting", python_backend: "unavailable" });
    });

    const unavailableApp = createOrbitApp(dependencies(async () => { throw new Error("connection refused"); }));
    await withApp(unavailableApp, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: "starting", python_backend: "unavailable" });
    });
});

test("the 4K Moon texture is served locally through the explicit assets route", async () => {
    const app = createOrbitApp(dependencies(async () => true));

    await withApp(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/assets/basemap/Moon_color_16bit_srgb_4k.png`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") || "", /^image\/png\b/i);
        const image = Buffer.from(await response.arrayBuffer());
        assert.equal(image.length > 10_000, true);
        assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    });
});

test("the generated distribution retains the Moon texture when source assets are stale", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-moon-texture-"));
    const frontDir = path.join(temporaryRoot, "front");
    const reactDistDir = path.join(temporaryRoot, "dist");
    const textureRelativePath = path.join("assets", "basemap", "Moon_color_16bit_srgb_4k.png");
    const generatedTexture = path.join(reactDistDir, textureRelativePath);

    await Promise.all([
        fs.mkdir(path.join(frontDir, "assets", "basemap"), { recursive: true }),
        fs.mkdir(path.dirname(generatedTexture), { recursive: true })
    ]);
    await Promise.all([
        fs.writeFile(generatedTexture, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        fs.writeFile(
            path.join(reactDistDir, "index.html"),
            "<meta name=\"orbit-identity-gate\" content=\"required\">"
        )
    ]);

    try {
        const app = createOrbitApp(dependencies(async () => true, {
            runtime: {
                reactDistDir,
                frontDir,
                configDir: temporaryRoot,
                docsSiteDir: path.join(temporaryRoot, "docs-site")
            }
        }));
        await withApp(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/assets/basemap/Moon_color_16bit_srgb_4k.png`);
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type") || "", /^image\/png\b/i);
            assert.deepEqual([...Buffer.from(await response.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
        });
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("a missing React distribution never falls back to the legacy unauthenticated frontend", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-react-gate-fallback-"));
    const frontDir = path.join(temporaryRoot, "front");
    const reactDistDir = path.join(temporaryRoot, "react-dist");
    const runtime = {
        reactDistDir,
        frontDir,
        configDir: temporaryRoot,
        docsSiteDir: path.join(temporaryRoot, "docs-site")
    };
    await Promise.all([
        fs.mkdir(frontDir, { recursive: true }),
        fs.mkdir(reactDistDir, { recursive: true })
    ]);
    await Promise.all([
        fs.writeFile(path.join(frontDir, "index.html"), "<script type=\"module\" src=\"main.js\"></script>legacy Orbit"),
        fs.writeFile(path.join(frontDir, "main.js"), "window.legacyOrbitStarted = true;")
    ]);

    try {
        const unavailableApp = createOrbitApp(dependencies(async () => true, { runtime }));
        await withApp(unavailableApp, async (baseUrl) => {
            for (const requestPath of ["/", "/index.html", "/main.js", "/%69ndex.html"]) {
                const response = await fetch(`${baseUrl}${requestPath}`);
                assert.equal(response.status, 503, requestPath);
                assert.equal(response.headers.get("cache-control"), "no-store");
                const body = await response.text();
                assert.match(body, /falta la distribución React verificada/i);
                assert.doesNotMatch(body, /legacy Orbit|legacyOrbitStarted|<script/i);
            }
        });

        // A stale Vite-looking distribution without the marker is still
        // rejected: it may predate the React identity gate.
        await fs.writeFile(path.join(reactDistDir, "index.html"), "<main>Old React bundle</main>");
        const staleApp = createOrbitApp(dependencies(async () => true, { runtime }));
        await withApp(staleApp, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/`);
            assert.equal(response.status, 503);
            assert.doesNotMatch(await response.text(), /Old React bundle/);
        });

        await fs.writeFile(
            path.join(reactDistDir, "index.html"),
            "<meta name=\"orbit-identity-gate\" content=\"required\"><main>React identity gate</main>"
        );
        const availableApp = createOrbitApp(dependencies(async () => true, { runtime }));
        await withApp(availableApp, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/`);
            assert.equal(response.status, 200);
            assert.match(await response.text(), /React identity gate/);
        });
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("the prebuilt MkDocs site is served from /Orbit without replacing FastAPI Swagger", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-docs-site-"));
    const docsSiteDir = path.join(temporaryRoot, "docs-site");
    const reactDistDir = path.join(temporaryRoot, "react-dist");
    const forwardedPaths = [];
    await Promise.all([
        fs.mkdir(docsSiteDir, { recursive: true }),
        fs.mkdir(path.join(reactDistDir, "Orbit"), { recursive: true })
    ]);
    await Promise.all([
        fs.writeFile(path.join(docsSiteDir, "index.html"), "<h1>Orbit documentation</h1>"),
        fs.writeFile(path.join(reactDistDir, "Orbit", "index.html"), "<h1>Frontend collision</h1>")
    ]);

    try {
        const app = createOrbitApp(dependencies(async () => true, {
            runtime: {
                reactDistDir,
                frontDir: path.join(temporaryRoot, "front"),
                configDir: temporaryRoot,
                docsSiteDir
            },
            pythonClient: {
                request: async (requestPath) => {
                    forwardedPaths.push(requestPath);
                    return new Response("<h1>FastAPI Swagger</h1>", {
                        headers: { "content-type": "text/html; charset=utf-8" }
                    });
                }
            }
        }));

        await withApp(app, async (baseUrl) => {
            const documentation = await fetch(`${baseUrl}/Orbit/`);
            assert.equal(documentation.status, 200);
            assert.match(await documentation.text(), /Orbit documentation/);

            const swagger = await fetch(`${baseUrl}/docs`);
            assert.equal(swagger.status, 200);
            assert.match(await swagger.text(), /FastAPI Swagger/);
        });

        assert.deepEqual(forwardedPaths, ["/docs"]);
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("precise products and manual ERP snapshots are not public static config assets", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-private-precise-products-"));
    const configDir = path.join(temporaryRoot, "config");
    const preciseDir = path.join(configDir, "precise-products", "igs-final");
    const manualErpDir = path.join(configDir, "manual-erp-snapshots", "deadbeef");
    const frontDir = path.join(temporaryRoot, "front");
    const reactDistDir = path.join(temporaryRoot, "react-dist");
    await Promise.all([
        fs.mkdir(preciseDir, { recursive: true }),
        fs.mkdir(manualErpDir, { recursive: true }),
        fs.mkdir(frontDir, { recursive: true }),
        fs.mkdir(reactDistDir, { recursive: true })
    ]);
    await Promise.all([
        fs.writeFile(path.join(configDir, "catalog.json"), '{"entries":[]}'),
        fs.writeFile(path.join(preciseDir, "IGS0OPSFIN_ORB.SP3.gz"), "private precise product"),
        fs.writeFile(path.join(manualErpDir, "source.erp"), "private manual ERP")
    ]);

    try {
        const app = createOrbitApp(dependencies(async () => true, {
            runtime: {
                reactDistDir,
                frontDir,
                configDir,
                docsSiteDir: path.join(temporaryRoot, "docs-site")
            }
        }));
        await withApp(app, async (baseUrl) => {
            const publicCatalog = await fetch(`${baseUrl}/config/catalog.json`);
            assert.equal(publicCatalog.status, 200, "normal public config assets remain available");

            for (const suffix of [
                "/config/precise-products/igs-final/IGS0OPSFIN_ORB.SP3.gz",
                "/config/PRECISE-PRODUCTS/igs-final/IGS0OPSFIN_ORB.SP3.gz",
                "/config/precise-products%2Figs-final%2FIGS0OPSFIN_ORB.SP3.gz",
                "/config/safe%2F..%2Fprecise-products%2Figs-final%2FIGS0OPSFIN_ORB.SP3.gz",
                "/config/manual-erp-snapshots/deadbeef/source.erp",
                "/config/MANUAL-ERP-SNAPSHOTS/deadbeef/source.erp",
                "/config/manual-erp-snapshots%2Fdeadbeef%2Fsource.erp",
                "/config/safe%2F..%2Fmanual-erp-snapshots%2Fdeadbeef%2Fsource.erp"
            ]) {
                const response = await fetch(`${baseUrl}${suffix}`);
                assert.equal(response.status, 404, suffix);
                assert.equal(await response.text(), "", "private raw bytes must not reach the response");
            }
        });
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("invalid JSON payloads use the API error contract without mutating configuration", async () => {
    let readCalls = 0;
    let saveCalls = 0;
    let scheduleCalls = 0;
    let reloadCalls = 0;
    const app = createOrbitApp(dependencies(async () => true, {
        config: {
            get: async () => {
                readCalls += 1;
                return { system: {}, data: {} };
            },
            save: async () => { saveCalls += 1; }
        },
        refresher: {
            refresh: async () => ({ ok: true }),
            schedule: async () => { scheduleCalls += 1; }
        },
        pythonBackend: {
            isHealthy: async () => true,
            reload: async () => { reloadCalls += 1; }
        }
    }));

    await withApp(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"system":'
        });
        assert.equal(response.status, 400);
        assert.match(response.headers.get("content-type"), /^application\/json/);
        assert.deepEqual(await response.json(), { ok: false, error: "Payload JSON invalido." });
    });

    assert.equal(readCalls, 0);
    assert.equal(saveCalls, 0);
    assert.equal(scheduleCalls, 0);
    assert.equal(reloadCalls, 0);
});

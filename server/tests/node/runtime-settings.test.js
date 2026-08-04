import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getRuntimeSettings } from "../../src/runtime/settings.js";

test("runtime settings preserve Docker defaults", () => {
    const settings = getRuntimeSettings({ serverDir: "/app/server", environment: {} });
    assert.equal(settings.port, 8100);
    assert.equal(settings.pythonBackendUrl, "http://127.0.0.1:8765");
    assert.equal(settings.configDir, path.join("/app/server", "../config"));
});

test("runtime settings accept valid deployment overrides and reject invalid ports", () => {
    const settings = getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "9000", PYTHON_BACKEND_URL: "http://python-api:8765/" } });
    assert.equal(settings.port, 9000);
    assert.equal(settings.pythonBackendUrl, "http://python-api:8765");
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "bad" } }).port, 8100);
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "9000.5" } }).port, 8100);
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "9000extra" } }).port, 8100);
});

test("runtime settings only accept HTTP(S) Python backend URLs", () => {
    const fallback = "http://127.0.0.1:8765";
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PYTHON_BACKEND_URL: "https://python-api:8765/" } }).pythonBackendUrl, "https://python-api:8765");
    for (const invalidUrl of [
        "https://python-api:8765/health",
        "https://python-api:8765/base/",
        "https://python-api:8765/?debug=true",
        "https://python-api:8765/#fragment",
        "https://user:secret@python-api:8765/",
        "file:///tmp/python",
        "ftp://python-api:8765"
    ]) {
        assert.equal(
            getRuntimeSettings({ serverDir: "/app/server", environment: { PYTHON_BACKEND_URL: invalidUrl } }).pythonBackendUrl,
            fallback,
            `${invalidUrl} must fall back to the trusted local Python backend origin`
        );
    }
});

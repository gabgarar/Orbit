import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getRuntimeSettings } from "../../src/runtime/settings.js";
import {
    DEFAULT_PYTHON_STARTUP_TIMEOUT_MS,
    MAX_PYTHON_STARTUP_TIMEOUT_MS,
    MIN_PYTHON_STARTUP_TIMEOUT_MS
} from "../../src/runtime/python-startup-timeout.js";
import {
    DEFAULT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS,
    MAX_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS,
    MIN_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
} from "../../src/runtime/numerical-orbit-timeout.js";

test("runtime settings preserve Docker defaults", () => {
    const settings = getRuntimeSettings({ serverDir: "/app/server", environment: {} });
    assert.equal(settings.port, 8100);
    assert.equal(settings.pythonBackendUrl, "http://127.0.0.1:8765");
    assert.equal(settings.pythonStartupTimeoutMs, DEFAULT_PYTHON_STARTUP_TIMEOUT_MS);
    assert.equal(settings.numericalOrbitProxyTimeoutMs, DEFAULT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS);
    assert.equal(settings.configDir, path.join("/app/server", "../config"));
    assert.equal(settings.docsSiteDir, path.join("/app/server", "../docs-site"));
});

test("runtime settings accept valid deployment overrides and reject invalid ports", () => {
    const settings = getRuntimeSettings({
        serverDir: "/app/server",
        environment: {
            PORT: "9000",
            PYTHON_BACKEND_URL: "http://python-api:8765/",
            ORBIT_PYTHON_STARTUP_TIMEOUT_MS: "240000",
            ORBIT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS: "90000"
        }
    });
    assert.equal(settings.port, 9000);
    assert.equal(settings.pythonBackendUrl, "http://python-api:8765");
    assert.equal(settings.pythonStartupTimeoutMs, 240_000);
    assert.equal(settings.numericalOrbitProxyTimeoutMs, 90_000);
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "bad" } }).port, 8100);
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "9000.5" } }).port, 8100);
    assert.equal(getRuntimeSettings({ serverDir: "/app/server", environment: { PORT: "9000extra" } }).port, 8100);
});

test("numerical-orbit deadlines are opt-in and otherwise remain safely bounded", () => {
    for (const invalidTimeout of [
        "", "not-a-number", "29999", "600001", "120000.5", "-1", "1e6", String(Number.MAX_SAFE_INTEGER + 1)
    ]) {
        assert.equal(
            getRuntimeSettings({
                serverDir: "/app/server",
                environment: { ORBIT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS: invalidTimeout }
            }).numericalOrbitProxyTimeoutMs,
            DEFAULT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS,
            `${invalidTimeout || "empty"} must use the safe default`
        );
    }

    assert.equal(
        getRuntimeSettings({
            serverDir: "/app/server",
            environment: { ORBIT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS: "0" }
        }).numericalOrbitProxyTimeoutMs,
        0,
        "0 explicitly keeps complete numerical calculations under user cancellation control"
    );

    assert.equal(
        getRuntimeSettings({
            serverDir: "/app/server",
            environment: { ORBIT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS: String(MIN_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS) }
        }).numericalOrbitProxyTimeoutMs,
        MIN_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
    );
    assert.equal(
        getRuntimeSettings({
            serverDir: "/app/server",
            environment: { ORBIT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS: String(MAX_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS) }
        }).numericalOrbitProxyTimeoutMs,
        MAX_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
    );
});

test("runtime settings bound the Python startup budget to a safe integer range", () => {
    for (const invalidTimeout of [
        "", "not-a-number", "9000", "600001", "180000.5", "-1", "1e6", String(Number.MAX_SAFE_INTEGER + 1)
    ]) {
        assert.equal(
            getRuntimeSettings({
                serverDir: "/app/server",
                environment: { ORBIT_PYTHON_STARTUP_TIMEOUT_MS: invalidTimeout }
            }).pythonStartupTimeoutMs,
            DEFAULT_PYTHON_STARTUP_TIMEOUT_MS,
            `${invalidTimeout || "empty"} must use the safe default`
        );
    }

    assert.equal(
        getRuntimeSettings({
            serverDir: "/app/server",
            environment: { ORBIT_PYTHON_STARTUP_TIMEOUT_MS: String(MIN_PYTHON_STARTUP_TIMEOUT_MS) }
        }).pythonStartupTimeoutMs,
        MIN_PYTHON_STARTUP_TIMEOUT_MS
    );
    assert.equal(
        getRuntimeSettings({
            serverDir: "/app/server",
            environment: { ORBIT_PYTHON_STARTUP_TIMEOUT_MS: String(MAX_PYTHON_STARTUP_TIMEOUT_MS) }
        }).pythonStartupTimeoutMs,
        MAX_PYTHON_STARTUP_TIMEOUT_MS
    );
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

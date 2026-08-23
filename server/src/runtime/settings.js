import path from "node:path";
import { DEFAULT_PYTHON_BACKEND_URL, normalizePythonBackendUrl } from "./backend-url.js";
import { readNumericalOrbitProxyTimeoutMs } from "./numerical-orbit-timeout.js";
import { readPythonStartupTimeoutMs } from "./python-startup-timeout.js";

function readPort(value, fallback) {
    const candidate = String(value ?? "").trim();
    if (!/^\d+$/.test(candidate)) return fallback;
    const port = Number(candidate);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

export function getRuntimeSettings({ serverDir, environment = process.env } = {}) {
    return Object.freeze({
        port: readPort(environment.PORT, 8100),
        pythonBackendUrl: normalizePythonBackendUrl(environment.PYTHON_BACKEND_URL, DEFAULT_PYTHON_BACKEND_URL),
        pythonStartupTimeoutMs: readPythonStartupTimeoutMs(environment.ORBIT_PYTHON_STARTUP_TIMEOUT_MS),
        numericalOrbitProxyTimeoutMs: readNumericalOrbitProxyTimeoutMs(
            environment.ORBIT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
        ),
        configDir: path.join(serverDir, "../config"),
        // Runtime-only caches and the server-managed browser-state generation
        // marker live alongside the bind-mounted operational data.
        dataDir: path.join(serverDir, "../data"),
        frontDir: path.join(serverDir, "../front"),
        reactDistDir: path.join(serverDir, "../front/dist"),
        // MkDocs is built into the image separately from the React bundle.
        // Keep it outside `front/` so the application can expose it at the
        // stable `/Orbit/` prefix without affecting the Python Swagger routes.
        docsSiteDir: path.join(serverDir, "../docs-site"),
        pythonDir: path.join(serverDir, "python")
    });
}

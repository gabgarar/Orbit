export const DEFAULT_PYTHON_BACKEND_URL = "http://127.0.0.1:8765";

function parsePythonBackendOrigin(value) {
    const candidate = String(value ?? "").trim();
    if (!candidate) return null;

    try {
        const url = new URL(candidate);
        const isHttp = url.protocol === "http:" || url.protocol === "https:";
        const hasOnlyOrigin = url.pathname === "/" && !url.search && !url.hash;
        const hasNoCredentials = !url.username && !url.password;
        return isHttp && hasOnlyOrigin && hasNoCredentials ? url : null;
    } catch {
        return null;
    }
}

export function normalizePythonBackendUrl(value, fallback = DEFAULT_PYTHON_BACKEND_URL) {
    const url = parsePythonBackendOrigin(value) || parsePythonBackendOrigin(fallback);
    if (!url) {
        throw new TypeError("A Python backend fallback URL must be an HTTP(S) origin.");
    }
    return url.origin;
}

export function requirePythonBackendUrl(value) {
    const url = parsePythonBackendOrigin(value);
    if (!url) {
        throw new TypeError("Python backend URL must be an HTTP(S) origin without path, query, hash, or credentials.");
    }
    return url;
}

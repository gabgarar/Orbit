import { requirePythonBackendUrl } from "../runtime/backend-url.js";

function validTimeoutMs(value) {
    const timeoutMs = Number(value);
    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
}

function isAbortSignal(value) {
    return value
        && typeof value === "object"
        && typeof value.addEventListener === "function"
        && typeof value.removeEventListener === "function";
}

function requestAbortSignal({ signal, timeout, setTimeoutImpl, clearTimeoutImpl }) {
    const externalSignal = isAbortSignal(signal) ? signal : undefined;
    if (!externalSignal && !timeout) return { signal: undefined, dispose: () => {} };
    if (!timeout) return { signal: externalSignal, dispose: () => {} };

    const controller = new AbortController();
    const abortFromExternalSignal = () => controller.abort(externalSignal.reason);
    if (externalSignal) {
        if (externalSignal.aborted) {
            abortFromExternalSignal();
        } else {
            externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
        }
    }
    const timer = controller.signal.aborted
        ? undefined
        : setTimeoutImpl(() => controller.abort(), timeout);

    return {
        signal: controller.signal,
        dispose: () => {
            if (timer !== undefined) clearTimeoutImpl(timer);
            if (externalSignal) {
                externalSignal.removeEventListener("abort", abortFromExternalSignal);
            }
        }
    };
}

export function createPythonClient(baseUrl, {
    fetchImpl = fetch,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
} = {}) {
    const backendUrl = requirePythonBackendUrl(baseUrl);

    async function request(path, { method = "GET", headers = {}, body, timeoutMs, signal } = {}) {
        const timeout = validTimeoutMs(timeoutMs);
        const abort = requestAbortSignal({ signal, timeout, setTimeoutImpl, clearTimeoutImpl });
        try {
            const target = new URL(path, backendUrl);
            if (target.origin !== backendUrl.origin) {
                throw new TypeError("Python backend request path must remain on the configured backend origin.");
            }
            return await fetchImpl(target, {
                method,
                headers,
                body,
                signal: abort.signal
            });
        } finally {
            abort.dispose();
        }
    }

    async function isHealthy(options = {}) {
        const signal = options?.signal;
        try {
            return (await request("/health", {
                headers: { Accept: "application/json" },
                timeoutMs: 1200,
                signal
            })).ok;
        } catch {
            return false;
        }
    }

    return { request, isHealthy };
}

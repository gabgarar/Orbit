const PROXY_ORIGIN = "http://proxy.invalid/";
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);
export const PYTHON_PROXY_TIMEOUT_MS = 30_000;

function isAbortError(error) {
    return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function appendQueryParameters(target, query = {}) {
    for (const [key, value] of Object.entries(query || {})) {
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item != null) target.searchParams.append(key, String(item));
        }
    }
}

function buildPythonPath(pythonPath, query) {
    const target = new URL(pythonPath, PROXY_ORIGIN);
    appendQueryParameters(target, query);
    return `${target.pathname}${target.search}`;
}

function buildPythonRequestOptions(request, timeoutMs = PYTHON_PROXY_TIMEOUT_MS) {
    const requestHeaders = request.headers || {};
    const headers = { Accept: requestHeaders.accept || "application/json" };
    const contentType = requestHeaders["content-type"];
    if (contentType) headers["Content-Type"] = contentType;

    return {
        method: request.method,
        headers,
        body: METHODS_WITHOUT_BODY.has(request.method) ? undefined : JSON.stringify(request.body),
        timeoutMs
    };
}

/**
 * Connect the browser/HTTP-client lifetime to the private Python request.
 *
 * The browser can abort a manual design calculation when its panel closes.
 * Node otherwise continues forwarding it after the client has gone away,
 * which leaves a costly Cowell calculation running without an owner. The
 * response's `close` event is checked against `writableEnded`: a normal
 * completed response also closes, but only a premature close cancels work.
 */
function createClientDisconnectSignal(request, response) {
    const controller = new AbortController();
    const abort = () => {
        if (!controller.signal.aborted) controller.abort();
    };
    const onRequestAborted = () => abort();
    const onResponseClosed = () => {
        if (response?.writableEnded !== true) abort();
    };

    if (request?.aborted === true || response?.destroyed === true) {
        abort();
    }
    request?.once?.("aborted", onRequestAborted);
    response?.once?.("close", onResponseClosed);

    return Object.freeze({
        signal: controller.signal,
        dispose: () => {
            request?.removeListener?.("aborted", onRequestAborted);
            response?.removeListener?.("close", onResponseClosed);
        }
    });
}

function sendUpstreamResponse(response, upstreamResponse, body) {
    const contentType = upstreamResponse.headers.get("content-type") || "application/json";
    response.status(upstreamResponse.status).set("Content-Type", contentType);
    const disposition = upstreamResponse.headers.get("content-disposition");
    if (disposition) response.set("Content-Disposition", disposition);
    response.send(body);
}

function sendProxyFailure(response, error, { timeoutMs, timeoutMessage } = {}) {
    // Node's fetch reports an elapsed AbortController deadline as the opaque
    // "This operation was aborted" DOMException.  That string describes an
    // implementation detail, not an operator action, and sent users looking
    // for a missing ERP/geopotential file when the actual cause was simply a
    // bounded numerical calculation.  Keep the ordinary upstream failure
    // contract, but make gateway deadlines explicit and actionable.
    if (isAbortError(error) && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        response.status(504).json({
            ok: false,
            error: timeoutMessage || `La operaci\u00f3n del servicio Python super\u00f3 el l\u00edmite de ${Math.ceil(timeoutMs / 1000)} s.`
        });
        return;
    }
    response.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
    });
}

export function createPythonForwarder(client, {
    timeoutMs = PYTHON_PROXY_TIMEOUT_MS,
    timeoutMessage
} = {}) {
    return async function forwardPythonRequest(request, response, pythonPath) {
        const clientDisconnect = createClientDisconnectSignal(request, response);
        try {
            const options = {
                ...buildPythonRequestOptions(request, timeoutMs),
                signal: clientDisconnect.signal
            };
            const upstreamResponse = await client.request(
                buildPythonPath(pythonPath, request.query),
                options
            );
            if (clientDisconnect.signal.aborted) return;
            // Python can return JSON, text, KMZ, WKB, or a GeoPackage.  Moving
            // every response through `.text()` corrupts binary products;
            // Buffer is lossless for all of them and Express still applies the
            // declared upstream content type for normal JSON/text callers.
            const body = Buffer.from(await upstreamResponse.arrayBuffer());
            if (clientDisconnect.signal.aborted) return;
            sendUpstreamResponse(response, upstreamResponse, body);
        } catch (error) {
            // A user cancellation owns the outcome. Do not manufacture a
            // 502/504 after its browser has already disconnected.
            if (clientDisconnect.signal.aborted) return;
            sendProxyFailure(response, error, { timeoutMs, timeoutMessage });
        } finally {
            clientDisconnect.dispose();
        }
    };
}

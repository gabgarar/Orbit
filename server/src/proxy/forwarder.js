const PROXY_ORIGIN = "http://proxy.invalid/";
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);
export const PYTHON_PROXY_TIMEOUT_MS = 30_000;

function appendQueryParameters(target, query = {}) {
    for (const [key, value] of Object.entries(query || {})) {
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item != null) target.searchParams.append(key, String(item));
        }
    }
}

export function buildPythonPath(pythonPath, query) {
    const target = new URL(pythonPath, PROXY_ORIGIN);
    appendQueryParameters(target, query);
    return `${target.pathname}${target.search}`;
}

export function buildPythonRequestOptions(request, timeoutMs = PYTHON_PROXY_TIMEOUT_MS) {
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

function sendUpstreamResponse(response, upstreamResponse, body) {
    const contentType = upstreamResponse.headers.get("content-type") || "application/json";
    response.status(upstreamResponse.status).set("Content-Type", contentType).send(body);
}

function sendProxyFailure(response, error) {
    response.status(502).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
    });
}

export function createPythonForwarder(client, { timeoutMs = PYTHON_PROXY_TIMEOUT_MS } = {}) {
    return async function forwardPythonRequest(request, response, pythonPath) {
        try {
            const upstreamResponse = await client.request(
                buildPythonPath(pythonPath, request.query),
                buildPythonRequestOptions(request, timeoutMs)
            );
            sendUpstreamResponse(response, upstreamResponse, await upstreamResponse.text());
        } catch (error) {
            sendProxyFailure(response, error);
        }
    };
}

/**
 * Transport for the non-persistent GNSS product preview.
 *
 * Keep this separate from the modal so a slow local proxy or a stalled
 * backend can never leave the operator in a permanent “Analizando…” state.
 */

export const PRECISE_PRODUCT_PREVIEW_TIMEOUT_MS = 30_000;

function validTimeout(value) {
    const timeout = Number(value);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : PRECISE_PRODUCT_PREVIEW_TIMEOUT_MS;
}

function errorMessage(payload, response) {
    return payload?.detail || payload?.error || `HTTP ${response?.status || 0}`;
}

/**
 * Request the satellite-only preview and fail deterministically if the local
 * service does not answer.  An optional external signal is used when the
 * modal is closed or its source files change while a request is in flight.
 */
export async function fetchPreciseProductPreview(payload, {
    fetchImpl = fetch,
    timeoutMs = PRECISE_PRODUCT_PREVIEW_TIMEOUT_MS,
    signal: externalSignal,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
} = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
        if (externalSignal.aborted) abortFromExternalSignal();
        else externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }

    const timer = setTimeoutImpl(() => {
        timedOut = true;
        controller.abort();
    }, validTimeout(timeoutMs));

    try {
        const response = await fetchImpl("/api/precise-products/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        const responsePayload = await response.json().catch(() => ({}));
        if (!response.ok || responsePayload?.ok === false) {
            throw new Error(errorMessage(responsePayload, response));
        }
        return responsePayload;
    } catch (error) {
        if (timedOut) {
            throw new Error("El análisis del producto GNSS tardó demasiado. Revisa el SP3 y vuelve a intentarlo.");
        }
        throw error;
    } finally {
        clearTimeoutImpl(timer);
        externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
    }
}

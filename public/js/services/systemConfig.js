/**
 * Client for the persisted Orbit runtime configuration.
 *
 * This module deliberately contains no UI or Cesium code so it can be reused
 * by the application shell and future feature plugins.
 */

export async function loadSystemConfig({ fetchImpl = fetch, onError = null } = {}) {
    try {
        const response = await fetchImpl("/config/system_config.json", { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        onError?.(error);
        return null;
    }
}

export async function saveSystemConfig(sectionedSystemConfig, dataConfig, { fetchImpl = fetch } = {}) {
    const response = await fetchImpl("/api/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system: sectionedSystemConfig,
            data: dataConfig
        })
    });

    if (!response.ok) {
        let detail = "";
        try {
            const payload = await response.json();
            detail = payload?.error ? `: ${payload.error}` : "";
        } catch {
            // A non-JSON error response still has a useful HTTP status.
        }
        throw new Error(`HTTP ${response.status}${detail}`);
    }
}

export async function saveSystemConfigWithRetry(sectionedSystemConfig, dataConfig, {
    fetchImpl = fetch,
    retries = 2,
    retryDelayMs = 180
} = {}) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            await saveSystemConfig(sectionedSystemConfig, dataConfig, { fetchImpl });
            return;
        } catch (error) {
            lastError = error;
            if (attempt >= retries) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        }
    }

    throw lastError;
}

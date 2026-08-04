const MINUTE_MS = 60_000;

/**
 * Obtains a stable retry instant from the catalogue refresh response.
 * Newer servers send `retryAt`/`retryAfterMs`; the message fallback keeps
 * clients compatible with a server that has not been rebuilt yet.
 */
export function getCatalogRefreshRetryAt(payload, now = Date.now()) {
    const retryAt = Date.parse(String(payload?.retryAt || ""));
    if (Number.isFinite(retryAt) && retryAt > now) return retryAt;

    const retryAfterMs = Number(payload?.retryAfterMs);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return now + retryAfterMs;

    const minutes = /dentro de\s+(\d+)\s+minutos?/i.exec(String(payload?.error || ""));
    const retryAfterMinutes = Number(minutes?.[1]);
    return Number.isFinite(retryAfterMinutes) && retryAfterMinutes > 0
        ? now + (retryAfterMinutes * MINUTE_MS)
        : null;
}

/** Formats an absolute retry instant as a compact live countdown. */
export function formatCatalogRefreshCountdown(retryAt, now = Date.now()) {
    const target = Number(retryAt);
    if (!Number.isFinite(target) || target <= now) return "ahora";

    const totalSeconds = Math.ceil((target - now) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, "0")} s` : `${seconds} s`;
}

// Rehydrating precise GNSS products can involve strict SP3/ERP validation,
// checksum verification and interpolation setup before the Python /health
// endpoint becomes available. Keep the operational budget explicit, bounded
// and shared by settings and the process supervisor.
export const PYTHON_STARTUP_POLL_INTERVAL_MS = 250;
export const DEFAULT_PYTHON_STARTUP_TIMEOUT_MS = 180_000;
export const MIN_PYTHON_STARTUP_TIMEOUT_MS = 10_000;
export const MAX_PYTHON_STARTUP_TIMEOUT_MS = 600_000;

export function readPythonStartupTimeoutMs(value, fallback = DEFAULT_PYTHON_STARTUP_TIMEOUT_MS) {
    const candidate = String(value ?? "").trim();
    if (!/^\d+$/.test(candidate)) return fallback;
    const timeoutMs = Number(candidate);
    return Number.isSafeInteger(timeoutMs)
        && timeoutMs >= MIN_PYTHON_STARTUP_TIMEOUT_MS
        && timeoutMs <= MAX_PYTHON_STARTUP_TIMEOUT_MS
        ? timeoutMs
        : fallback;
}

export function getPythonStartupAttempts(timeoutMs, pollIntervalMs = PYTHON_STARTUP_POLL_INTERVAL_MS) {
    const safeTimeoutMs = readPythonStartupTimeoutMs(timeoutMs);
    const safePollIntervalMs = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
        ? pollIntervalMs
        : PYTHON_STARTUP_POLL_INTERVAL_MS;
    return Math.ceil(safeTimeoutMs / safePollIntervalMs);
}

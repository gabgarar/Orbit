// Manual Cowell previews and propagated-parameter requests can legitimately
// perform thousands of RK4 stages. Unlike ordinary Python API calls, there is
// deliberately no gateway deadline by default: the operator owns the complete
// requested calculation and may cancel it from Orbit's activity panel. A
// deployment may opt into a bounded deadline when it has its own service SLO.
export const DEFAULT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS = 0;
export const MIN_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS = 30_000;
export const MAX_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS = 600_000;

export function readNumericalOrbitProxyTimeoutMs(
    value,
    fallback = DEFAULT_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
) {
    const candidate = String(value ?? "").trim();
    if (!candidate) return fallback;
    if (candidate === "0") return 0;
    if (!/^\d+$/.test(candidate)) return fallback;
    const timeoutMs = Number(candidate);
    return Number.isSafeInteger(timeoutMs)
        && timeoutMs >= MIN_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
        && timeoutMs <= MAX_NUMERICAL_ORBIT_PROXY_TIMEOUT_MS
        ? timeoutMs
        : fallback;
}

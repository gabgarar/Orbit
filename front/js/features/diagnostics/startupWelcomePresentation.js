import { findDiagnosticComponent } from "./diagnosticsContract.js";
import { getStartupProjectReadiness } from "./startupStatus.js";

// A warm local cache can make the first authoritative diagnostics response
// arrive almost immediately. Keep the startup surface visible briefly so the
// user can see that Orbit checked the already-validated local data, rather
// than appearing to skip startup altogether.
export const STARTUP_WELCOME_MINIMUM_PRESENTATION_MS = 750;

function finiteNonNegative(value) {
    const candidate = Number(value);
    return Number.isFinite(candidate) ? Math.max(0, candidate) : 0;
}

/**
 * A browser-side event or an old cached window value is useful for progress,
 * but it cannot authorise the initial welcome transition. Only the current
 * diagnostics response containing its `startup` component is authoritative.
 */
export function hasAuthoritativeStartupSnapshot({ diagnostics = null, availability = "loading" } = {}) {
    return availability === "available" && Boolean(findDiagnosticComponent(diagnostics, "startup"));
}

/**
 * Decide whether the central preparation surface must remain visible.
 *
 * This deliberately fails closed: no diagnostics snapshot, a snapshot that
 * is not explicitly ready, or an unfinished minimum presentation interval
 * all keep project controls hidden.
 */
export function getStartupWelcomePresentation({
    startup = null,
    diagnostics = null,
    availability = "loading",
    elapsedMs = 0,
    minimumDurationMs = STARTUP_WELCOME_MINIMUM_PRESENTATION_MS
} = {}) {
    const readiness = getStartupProjectReadiness(startup);
    const authoritativeSnapshot = hasAuthoritativeStartupSnapshot({ diagnostics, availability });
    const minimumElapsed = finiteNonNegative(elapsedMs) >= finiteNonNegative(minimumDurationMs);
    const ready = authoritativeSnapshot && readiness.ready === true;
    const isPreparing = !authoritativeSnapshot || !ready || !minimumElapsed;
    const phase = !authoritativeSnapshot
        ? "awaiting-snapshot"
        : !ready
            ? "preparing"
            : !minimumElapsed
                ? "verified-cache"
                : "ready";

    return Object.freeze({
        authoritativeSnapshot,
        readiness,
        ready,
        minimumElapsed,
        isPreparing,
        phase,
        allowProjectActions: !isPreparing
    });
}

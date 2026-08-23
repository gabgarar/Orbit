/**
 * Active satellite temporal domain
 * ================================
 *
 * The Master Time Range only represents exact, finite ephemerides (SP3,
 * OEM and authored tracks).  A TLE is different: its epoch is an operational
 * lower availability bound, while its forward display horizon is a user
 * preference rather than historical coverage.  This small, DOM-free module
 * derives a fresh scene window from the layers that are active *now*, so a
 * removed SP3 can never leave a stale multi-day range behind.
 */

const HOUR_MS = 60 * 60 * 1000;

function toEpochMilliseconds(value) {
    if (value instanceof Date) {
        const milliseconds = value.getTime();
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
        const milliseconds = Number(raw);
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    const milliseconds = Date.parse(raw);
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

function normalizeRange(candidate) {
    if (!candidate || typeof candidate !== "object") return null;
    const startTimeMs = toEpochMilliseconds(candidate.startTimeMs ?? candidate.startDate ?? candidate.startTime ?? candidate.start);
    const endTimeMs = toEpochMilliseconds(candidate.endTimeMs ?? candidate.endDate ?? candidate.endTime ?? candidate.end);
    if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) {
        return null;
    }
    return { startTimeMs, endTimeMs };
}

/**
 * Build the deliberately short-lived operating window for one TLE/OMM
 * source.  It is anchored at now when the epoch has already passed, or at the
 * epoch when it is in the future.  In particular it never stretches from an
 * old TLE epoch through wall-clock now merely because a prior SP3 simulation
 * happened to be long.
 */
export function buildTleOperationalTimeRange({ epoch, now = new Date(), propagationHours = 12 } = {}) {
    const nowMs = toEpochMilliseconds(now);
    if (!Number.isFinite(nowMs)) return null;
    const epochMs = toEpochMilliseconds(epoch);
    const requestedHours = Number(propagationHours);
    const horizonHours = Number.isFinite(requestedHours) && requestedHours >= 0
        ? requestedHours
        : 12;
    const startTimeMs = Number.isFinite(epochMs) ? Math.max(nowMs, epochMs) : nowMs;
    const endTimeMs = startTimeMs + (horizonHours * HOUR_MS);
    if (!Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) return null;
    return { startTimeMs, endTimeMs };
}

/**
 * Resolve the current scene's temporal mode from active source ranges only.
 * Exact finite coverage and forward TLE operating windows form an envelope
 * when both are active.  No active orbital source deliberately means Real
 * time: callers must not retain a formerly active SP3/MTR interval.
 */
export function resolveActiveSatelliteTimeDomain({ finiteRanges = [], tleRanges = [] } = {}) {
    const finite = (Array.isArray(finiteRanges) ? finiteRanges : [])
        .map(normalizeRange)
        .filter(Boolean);
    const tle = (Array.isArray(tleRanges) ? tleRanges : [])
        .map(normalizeRange)
        .filter(Boolean);
    const ranges = [...finite, ...tle];
    if (!ranges.length) {
        return { mode: "realtime", source: "none", range: null };
    }
    const source = finite.length && tle.length
        ? "mixed"
        : finite.length
            ? "finite"
            : "tle";
    return {
        mode: "range",
        source,
        range: {
            startTimeMs: Math.min(...ranges.map((range) => range.startTimeMs)),
            endTimeMs: Math.max(...ranges.map((range) => range.endTimeMs))
        }
    };
}

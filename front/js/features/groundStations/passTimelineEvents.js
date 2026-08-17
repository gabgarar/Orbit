/**
 * Compact event contract for the simulation time bar.
 *
 * A single access window produces three independently-addressable timeline
 * events: exact AOS, exact LOS, and the useful inspection instant at maximum
 * elevation.  The runtime owns which station/satellite pairs are eligible;
 * this module deliberately stays renderer- and transport-free so the timeline
 * can consume the same records later in a calendar or report.
 */

export const GROUND_STATION_TIMELINE_EVENTS_EVENT = "orbit:ground-station-timeline-events";

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function isoTime(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function maximumTime(pass) {
    const exact = isoTime(pass?.max_elevation_time);
    // A midpoint is useful for a legacy single-pass inspection action, but it
    // is not a physical maximum. The aggregate timeline reserves its green
    // marker for an actual maximum-elevation sample reported by AOS/LOS.
    return exact ? { time: exact, source: "maximum" } : null;
}

/**
 * Expand one station/satellite result into display-independent event records.
 *
 * ``satelliteId`` intentionally remains the workspace layer id: duplicate
 * layers may share a source propagator but have independently visible rows in
 * the scene.  ``sourceSatelliteId`` keeps the underlying catalogue/manual id
 * available for exports without weakening that visibility contract.
 */
export function buildGroundStationPassTimelineEvents({
    stationId,
    stationName,
    satelliteLayerId,
    sourceSatelliteId,
    satelliteName,
    passes
} = {}) {
    const station = text(stationId);
    const layer = text(satelliteLayerId);
    if (!station || !layer || !Array.isArray(passes)) return [];

    const entries = [];
    passes.forEach((pass, index) => {
        const passId = `${station}:${layer}:${index}`;
        const common = {
            stationId: station,
            stationName: text(stationName) || station,
            satelliteId: layer,
            satelliteLayerId: layer,
            sourceSatelliteId: text(sourceSatelliteId) || layer,
            satelliteName: text(satelliteName) || layer,
            passId,
            passIndex: index
        };
        const maximum = maximumTime(pass);
        const elevationDeg = Number(pass?.max_elevation_deg);
        if (maximum) {
            entries.push({
                ...common,
                id: `${passId}:max`,
                time: maximum.time,
                eventType: "max",
                maximumTimeSource: maximum.source,
                ...(Number.isFinite(elevationDeg) ? { elevationDeg } : {})
            });
        }
        const aos = isoTime(pass?.aos);
        if (aos) {
            entries.push({ ...common, id: `${passId}:aos`, time: aos, eventType: "aos" });
        }
        const los = isoTime(pass?.los);
        if (los) {
            entries.push({ ...common, id: `${passId}:los`, time: los, eventType: "los" });
        }
    });

    const order = { max: 0, aos: 1, los: 2 };
    return entries.sort((left, right) => (
        Date.parse(left.time) - Date.parse(right.time)
        || left.passId.localeCompare(right.passId)
        || (order[left.eventType] ?? 9) - (order[right.eventType] ?? 9)
    ));
}

/** Filter cached records against the current Layer-eye state without I/O. */
export function filterGroundStationPassTimelineEvents(events, isVisible) {
    if (!Array.isArray(events) || typeof isVisible !== "function") return [];
    return events.filter((event) => isVisible(event.stationId, event.satelliteLayerId) === true);
}

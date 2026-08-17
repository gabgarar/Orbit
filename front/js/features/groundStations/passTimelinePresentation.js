import { getTimelinePosition } from "./passTimeline.js";
export { GROUND_STATION_TIMELINE_EVENTS_EVENT } from "./passTimelineEvents.js";

/**
 * Event contract published by the scene while the simulation timeline is
 * active.  The scene is responsible for calculating the passes and for
 * dropping hidden objects; this module is the final presentation safeguard so
 * a stale visibility update never leaves a marker behind in React.
 */
const eventTypes = new Set(["max", "aos", "los"]);
const eventLabels = {
    max: "máxima elevación",
    aos: "AOS",
    los: "LOS"
};

function text(value) {
    return String(value ?? "").trim();
}

function timestamp(value) {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function eventId(event, index) {
    const explicitId = text(event?.id);
    if (explicitId) return explicitId;
    return [
        text(event?.stationId),
        text(event?.satelliteId || event?.satelliteLayerId),
        text(event?.passId),
        text(event?.eventType),
        timestamp(event?.time) ?? index
    ].join(":");
}

function passKey(event, index) {
    const stationId = text(event?.stationId);
    const satelliteId = text(event?.satelliteId || event?.satelliteLayerId);
    const passId = text(event?.passId);
    if (passId) return `${stationId}:${satelliteId}:${passId}`;
    const pairIndex = Number.isInteger(event?.pairIndex) ? event.pairIndex : "";
    const passIndex = Number.isInteger(event?.passIndex) ? event.passIndex : "";
    if (pairIndex !== "" && passIndex !== "") return `${stationId}:${satelliteId}:pair-${pairIndex}:pass-${passIndex}`;
    return `event:${eventId(event, index)}`;
}

/** Return true only for a valid visible event in the public scene contract. */
export function isVisiblePassTimelineEvent(event) {
    const type = text(event?.eventType).toLowerCase();
    return event?.visible !== false
        && event?.stationVisible !== false
        && event?.satelliteVisible !== false
        && eventTypes.has(type)
        && timestamp(event?.time) !== null;
}

/**
 * Normalize an aggregate timeline payload.  Unknown fields deliberately pass
 * through so the renderer can be extended with new event metadata without a
 * React deploy becoming a correctness boundary.
 */
export function normalizeGroundStationTimelineEvents(detail = {}) {
    const events = Array.isArray(detail?.events) ? detail.events : [];
    return events
        .filter(isVisiblePassTimelineEvent)
        .map((event, index) => ({
            ...event,
            id: eventId(event, index),
            eventType: text(event.eventType).toLowerCase(),
            stationId: text(event.stationId),
            stationName: text(event.stationName),
            satelliteId: text(event.satelliteId || event.satelliteLayerId),
            satelliteName: text(event.satelliteName),
            passId: text(event.passId),
            time: timestamp(event.time),
            passKey: passKey(event, index),
            elevationDeg: Number(event.elevationDeg)
        }))
        .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

/**
 * Bridge one historical AOS/LOS result into the aggregate event contract.
 * Keeping this adapter means an older runtime still gets the richer timeline
 * display after a React-only upgrade.
 */
export function legacyGroundStationPassesToTimelineEvents(detail = {}) {
    const passes = Array.isArray(detail?.passes) ? detail.passes : [];
    const stationId = text(detail.stationId || detail.station?.id || detail.analysisSelection?.stationId);
    const stationName = text(detail.stationName || detail.station?.name);
    const satelliteId = text(detail.satelliteId || detail.satelliteLayerId || detail.analysisSelection?.satelliteLayerId);
    const satelliteName = text(detail.satelliteName || detail.satellite);

    return passes.flatMap((pass, index) => {
        const prefix = `legacy:${stationId}:${satelliteId}:${index}`;
        const common = {
            stationId,
            stationName,
            satelliteId,
            satelliteName,
            passId: prefix,
            visible: true
        };
        const maximumTime = timestamp(pass?.max_elevation_time);
        const rawEvents = [
            maximumTime !== null && {
                ...common,
                id: `${prefix}:max`,
                eventType: "max",
                time: maximumTime,
                elevationDeg: Number(pass?.max_elevation_deg)
            },
            {
                ...common,
                id: `${prefix}:aos`,
                eventType: "aos",
                time: pass?.aos
            },
            {
                ...common,
                id: `${prefix}:los`,
                eventType: "los",
                time: pass?.los
            }
        ];
        return rawEvents.filter(Boolean);
    });
}

/**
 * Prepare events for a concrete timeline.  Each marker keeps references to
 * its sibling AOS/LOS/maximum samples so its tooltip can describe a complete
 * pass while the individual glyph remains a direct, keyboard-accessible jump
 * target.
 */
export function getPassTimelinePresentation(events, startDate, endDate) {
    const normalized = normalizeGroundStationTimelineEvents({ events });
    const grouped = new Map();
    normalized.forEach((event) => {
        const group = grouped.get(event.passKey) || [];
        group.push(event);
        grouped.set(event.passKey, group);
    });

    return normalized.flatMap((event) => {
        const position = getTimelinePosition(event.time, startDate, endDate);
        if (position === null || position < 0 || position > 100) return [];
        return [{
            ...event,
            position,
            label: eventLabels[event.eventType] || event.eventType,
            relatedEvents: grouped.get(event.passKey) || []
        }];
    });
}

export function passTimelineEventLabel(eventType) {
    return eventLabels[text(eventType).toLowerCase()] || text(eventType);
}

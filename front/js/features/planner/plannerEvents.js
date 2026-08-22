import {
    EOP_COVERAGE_SOURCE_KINDS,
    normalizeEopCoverageTimeline
} from "../timekeeping/eopCoveragePolicy.js";

/**
 * Planner event contract and UTC layout helpers.
 *
 * This module is intentionally renderer- and DOM-free.  The scene runtime
 * produces facts (passes, validated resource horizons and authored entries),
 * while React can render the normalized output in a day, week or month view.
 * Invalid facts are discarded rather than guessed: in particular, a coverage
 * end is never treated as an expiry unless the caller explicitly maps it to
 * `validityEnd`, and no timestamp is filled with `Date.now()`.
 */

export const PLANNER_STATE_EVENT = "orbit:planner-state";
export const PLANNER_MANUAL_EVENT_UPSERT_EVENT = "orbit:planner-manual-event-upsert";
export const PLANNER_MANUAL_EVENT_REMOVE_EVENT = "orbit:planner-manual-event-remove";

/**
 * Planner-only identity for the automatic Earth-orientation source ranges.
 * It is deliberately not a Cesium scene layer: hiding it changes only the
 * agenda and its preference is persisted with the project like every other
 * planner layer filter.
 */
export const PLANNER_EOP_LAYER_ID = "planner:iers-eop";

/**
 * Planner-only identity for ERP files bound to an imported precise product.
 * It deliberately differs from the automatic IERS layer: a product ERP is
 * an immutable local input with its own verified UTC coverage, not a cache
 * of the shared IERS route.
 */
export const PLANNER_PRODUCT_ERP_LAYER_ID = "planner:product-erp";

/**
 * Display states for factual Earth-orientation intervals.  They are kept
 * separate from the provider's scientific `quality` value: a stable
 * renderer can use them as a compact, operator-facing legend while details
 * retain the exact IERS provenance and quality label.
 */
export const PLANNER_EOP_VISUAL_STATES = Object.freeze({
    NORMAL: "normal",
    OK: "ok",
    PREDICTED: "predicted",
    DEGRADED: "degraded"
});

export const PLANNER_EVENT_KINDS = Object.freeze({
    PASS_AOS: "pass-aos",
    PASS_MAXIMUM: "pass-maximum",
    PASS_LOS: "pass-los",
    ERP_EXPIRY: "erp-expiry",
    ERP_VALIDITY_END: "erp-validity-end",
    SP3_EXPIRY: "sp3-expiry",
    SP3_VALIDITY_END: "sp3-validity-end",
    OEM_EXPIRY: "oem-expiry",
    OEM_VALIDITY_END: "oem-validity-end",
    LAYER_EXPIRY: "layer-expiry",
    LAYER_VALIDITY_END: "layer-validity-end",
    // These are source-backed layer facts, not synthetic availability
    // promises.  `layer-imported` is emitted only when the import service
    // recorded an import timestamp; `tle-epoch` comes from the two-line
    // element set itself.
    LAYER_IMPORTED: "layer-imported",
    TLE_EPOCH: "tle-epoch",
    // EOP records are source intervals, not cache expirations or a series
    // of duplicated end markers. The planner resolves overlapping official
    // products according to the operational preference (C01, then Finals).
    IERS_C01_COVERAGE: "iers-c01-coverage",
    FINALS2000A_COVERAGE: "finals2000a-coverage",
    ERP_LINEAR_EXTRAPOLATION: "erp-linear-extrapolation",
    ERP_NOMINAL_FALLBACK: "erp-nominal-fallback",
    PRODUCT_ERP_COVERAGE: "product-erp-coverage",
    MANUAL: "manual"
});

/** Stable semantic colour tokens; renderers own the concrete CSS palette. */
export const PLANNER_COLOR_TOKENS = Object.freeze({
    EMERALD: "emerald",
    PURPLE: "purple",
    AMBER: "amber",
    ROSE: "rose",
    BLUE: "blue",
    CYAN: "cyan",
    SLATE: "slate"
});

export const PLANNER_MANUAL_COLOR_TOKENS = Object.freeze([
    PLANNER_COLOR_TOKENS.BLUE,
    PLANNER_COLOR_TOKENS.CYAN,
    PLANNER_COLOR_TOKENS.EMERALD,
    PLANNER_COLOR_TOKENS.PURPLE,
    PLANNER_COLOR_TOKENS.AMBER,
    PLANNER_COLOR_TOKENS.ROSE,
    PLANNER_COLOR_TOKENS.SLATE
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const knownStatuses = new Set(["loading", "ready", "error"]);
const knownKinds = new Set(Object.values(PLANNER_EVENT_KINDS));
const manualColours = new Set(PLANNER_MANUAL_COLOR_TOKENS);
const resourceTypes = new Set(["erp", "sp3", "oem", "layer"]);

export const PLANNER_EVENT_PRESENTATION = Object.freeze({
    [PLANNER_EVENT_KINDS.PASS_AOS]: Object.freeze({
        source: "ground-station",
        label: "AOS",
        colorToken: PLANNER_COLOR_TOKENS.PURPLE
    }),
    [PLANNER_EVENT_KINDS.PASS_MAXIMUM]: Object.freeze({
        source: "ground-station",
        label: "Máxima elevación",
        colorToken: PLANNER_COLOR_TOKENS.EMERALD
    }),
    [PLANNER_EVENT_KINDS.PASS_LOS]: Object.freeze({
        source: "ground-station",
        label: "LOS",
        colorToken: PLANNER_COLOR_TOKENS.PURPLE
    }),
    [PLANNER_EVENT_KINDS.ERP_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad ERP",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.ERP_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez ERP",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.SP3_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad SP3",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.SP3_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez SP3",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.OEM_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad OEM",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.OEM_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez OEM",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.LAYER_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad de capa",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.LAYER_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez de capa",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.LAYER_IMPORTED]: Object.freeze({
        source: "layer",
        label: "Capa importada",
        colorToken: PLANNER_COLOR_TOKENS.CYAN
    }),
    [PLANNER_EVENT_KINDS.TLE_EPOCH]: Object.freeze({
        source: "layer",
        label: "Época TLE",
        colorToken: PLANNER_COLOR_TOKENS.BLUE
    }),
    [PLANNER_EVENT_KINDS.IERS_C01_COVERAGE]: Object.freeze({
        source: "eop",
        label: "IERS C01",
        colorToken: PLANNER_COLOR_TOKENS.EMERALD
    }),
    [PLANNER_EVENT_KINDS.FINALS2000A_COVERAGE]: Object.freeze({
        source: "eop",
        label: "IERS finals2000A",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.ERP_LINEAR_EXTRAPOLATION]: Object.freeze({
        source: "eop",
        label: "Extrapolación lineal ERP",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.ERP_NOMINAL_FALLBACK]: Object.freeze({
        source: "eop",
        label: "Rotación terrestre nominal",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.PRODUCT_ERP_COVERAGE]: Object.freeze({
        source: "erp",
        label: "ERP asociado a SP3",
        colorToken: PLANNER_COLOR_TOKENS.CYAN
    }),
    [PLANNER_EVENT_KINDS.MANUAL]: Object.freeze({
        source: "manual",
        label: "Evento manual",
        colorToken: PLANNER_COLOR_TOKENS.BLUE
    })
});

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function firstPresent(object, keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(object || {}, key)) {
            return { present: true, value: object[key] };
        }
    }
    return { present: false, value: undefined };
}

function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validIsoTimestamp(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", , zone] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    if (zone !== "Z") {
        const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
        if (offsetHour > 23 || offsetMinute > 59) return null;
    }
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) && Number.isFinite(new Date(epoch).getTime()) ? epoch : null;
}

/**
 * Parse an unambiguous timestamp without relying on the browser's local zone.
 * Strings must be ISO-8601 datetimes with `Z` or a numeric offset; `Date`
 * objects and finite epoch milliseconds are accepted for runtime bridges.
 */
export function toPlannerEpochMs(value) {
    if (value instanceof Date) {
        const epoch = value.getTime();
        return Number.isFinite(epoch) ? epoch : null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
    }
    if (typeof value !== "string") return null;
    const candidate = value.trim();
    return candidate ? validIsoTimestamp(candidate) : null;
}

export function plannerIsoTimestamp(value) {
    const epoch = toPlannerEpochMs(value);
    return epoch === null ? null : new Date(epoch).toISOString();
}

function normalizeKind(value) {
    const kind = text(value).toLowerCase();
    return knownKinds.has(kind) ? kind : null;
}

function normalizeColorToken(value, fallback, strict) {
    if (value === undefined || value === null || text(value) === "") return fallback;
    const color = text(value).toLowerCase();
    if (manualColours.has(color)) return color;
    return strict ? null : fallback;
}

function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function generatedId({ source, kind, title, start, end, colorToken }) {
    return `planner:${source}:${kind}:${stableHash([title, start, end, colorToken].join("\u001f"))}`;
}

function normalizeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return { ...value };
}

/**
 * Normalize one planner record. Unknown kinds, malformed timestamps and an
 * end before its start all return `null`. A point event intentionally has an
 * equal start/end, while a manual event must be a real interval.
 */
export function normalizePlannerEvent(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const kind = normalizeKind(input.kind || input.eventKind);
    if (!kind) return null;
    const presentation = PLANNER_EVENT_PRESENTATION[kind];
    const startCandidate = firstPresent(input, ["start", "startTime", "time"]);
    const startMs = startCandidate.present ? toPlannerEpochMs(startCandidate.value) : null;
    if (startMs === null) return null;

    const endCandidate = firstPresent(input, ["end", "endTime"]);
    const endMs = endCandidate.present ? toPlannerEpochMs(endCandidate.value) : startMs;
    if (endMs === null || endMs < startMs) return null;
    if (kind === PLANNER_EVENT_KINDS.MANUAL && (!endCandidate.present || endMs <= startMs)) return null;

    const configuredColor = normalizeColorToken(
        input.colorToken ?? input.color,
        presentation.colorToken,
        kind === PLANNER_EVENT_KINDS.MANUAL
    );
    if (!configuredColor) return null;

    const source = kind === PLANNER_EVENT_KINDS.MANUAL
        ? "manual"
        : text(input.source) || presentation.source;
    const title = text(input.title || input.name || input.label) || presentation.label;
    const start = new Date(startMs).toISOString();
    const end = new Date(endMs).toISOString();
    const id = text(input.id) || generatedId({ source, kind, title, start, end, colorToken: configuredColor });
    if (!id) return null;

    return {
        id,
        source,
        kind,
        title,
        start,
        end,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        isPoint: startMs === endMs,
        allDay: input.allDay === true,
        colorToken: configuredColor,
        metadata: normalizeMetadata(input.metadata)
    };
}

export function normalizeManualPlannerEvent(input = {}) {
    return normalizePlannerEvent({ ...input, kind: PLANNER_EVENT_KINDS.MANUAL, source: "manual" });
}

export function comparePlannerEvents(left, right) {
    return left.startMs - right.startMs
        || left.endMs - right.endMs
        || left.id.localeCompare(right.id);
}

/** Normalise, de-duplicate and chronologically sort a collection. */
export function normalizePlannerEvents(events) {
    if (!Array.isArray(events)) return [];
    const seen = new Set();
    return events
        .map((event) => normalizePlannerEvent(event))
        .filter((event) => {
            if (!event || seen.has(event.id)) return false;
            seen.add(event.id);
            return true;
        })
        .sort(comparePlannerEvents);
}

function passKind(eventType) {
    switch (text(eventType).toLowerCase()) {
    case "aos": return PLANNER_EVENT_KINDS.PASS_AOS;
    case "max": return PLANNER_EVENT_KINDS.PASS_MAXIMUM;
    case "los": return PLANNER_EVENT_KINDS.PASS_LOS;
    default: return null;
    }
}

/**
 * Adapt the ground-station timeline contract. Hidden or incomplete source
 * records cannot escape into the planner even if an old runtime publishes one.
 */
export function buildPlannerPassEvents(passEvents) {
    if (!Array.isArray(passEvents)) return [];
    return normalizePlannerEvents(passEvents.flatMap((raw) => {
        const kind = passKind(raw?.eventType);
        const stationId = text(raw?.stationId);
        const satelliteId = text(raw?.satelliteId || raw?.satelliteLayerId);
        if (!kind || !stationId || !satelliteId) return [];
        if (raw?.visible === false || raw?.stationVisible === false || raw?.satelliteVisible === false) return [];
        const stationName = text(raw?.stationName) || stationId;
        const satelliteName = text(raw?.satelliteName) || satelliteId;
        const label = PLANNER_EVENT_PRESENTATION[kind].label;
        const rawId = text(raw?.id) || [stationId, satelliteId, text(raw?.passId), raw?.eventType, raw?.time].join(":");
        const event = normalizePlannerEvent({
            id: `pass:${rawId}`,
            source: "ground-station",
            kind,
            title: `${label} · ${stationName} — ${satelliteName}`,
            time: raw?.time,
            metadata: {
                stationId,
                stationName,
                satelliteId,
                satelliteLayerId: satelliteId,
                sourceSatelliteId: text(raw?.sourceSatelliteId),
                satelliteName,
                passId: text(raw?.passId),
                elevationDeg: Number.isFinite(Number(raw?.elevationDeg)) ? Number(raw.elevationDeg) : undefined
            }
        });
        return event ? [event] : [];
    }));
}

function normalizeResourceType(value) {
    const type = text(value).toLowerCase().replaceAll("_", "-");
    if (type === "imported-layer" || type === "import-layer") return "layer";
    return resourceTypes.has(type) ? type : null;
}

function resourceKind(type, suffix) {
    const key = `${type}-${suffix}`.toUpperCase().replaceAll("-", "_");
    return PLANNER_EVENT_KINDS[key] || null;
}

/**
 * Turn explicit resource facts into planner notices.  Accepted input is
 * `{id, resourceType, name?, expiresAt?, validityEnd?, metadata?}`. A raw
 * `coverageEnd` is deliberately not inspected: callers must explicitly say
 * it represents a validity boundary by mapping it to `validityEnd`.
 */
export function buildPlannerResourceEvents(resources) {
    if (!Array.isArray(resources)) return [];
    return normalizePlannerEvents(resources.flatMap((resource) => {
        const resourceId = text(resource?.id);
        const type = normalizeResourceType(resource?.resourceType || resource?.type);
        if (!resourceId || !type) return [];
        const name = text(resource?.name || resource?.title || resource?.label) || resourceId;
        const commonMetadata = {
            resourceId,
            resourceType: type,
            ...normalizeMetadata(resource?.metadata)
        };
        const candidates = [
            { field: "expiresAt", suffix: "expiry" },
            { field: "validityEnd", suffix: "validity-end" }
        ];
        return candidates.flatMap(({ field, suffix }) => {
            if (!Object.prototype.hasOwnProperty.call(resource, field)) return [];
            const kind = resourceKind(type, suffix);
            const event = normalizePlannerEvent({
                id: `resource:${type}:${resourceId}:${suffix}`,
                source: "resource",
                kind,
                time: resource[field],
                title: `${PLANNER_EVENT_PRESENTATION[kind]?.label || suffix} · ${name}`,
                metadata: commonMetadata
            });
            return event ? [event] : [];
        });
    }));
}

const EOP_SOURCE_PRIORITY = Object.freeze({
    [EOP_COVERAGE_SOURCE_KINDS.C01]: 30,
    [EOP_COVERAGE_SOURCE_KINDS.FINALS]: 20,
    [EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION]: 10,
    [EOP_COVERAGE_SOURCE_KINDS.NOMINAL]: 5
});

function eopSourcePriority(segment) {
    return EOP_SOURCE_PRIORITY[segment?.kind] || 0;
}

function eopSegmentAt(segments, instantMs) {
    return segments
        .filter((segment) => segment.startMs <= instantMs && (segment.endMs === null || instantMs < segment.endMs))
        .sort((left, right) => (
            eopSourcePriority(right) - eopSourcePriority(left)
            || (right.precedence || 0) - (left.precedence || 0)
            || String(left.quality || "").localeCompare(String(right.quality || ""))
        ))[0] || null;
}

function sameEopProvenance(left, right) {
    return left?.kind === right?.kind
        && left?.source === right?.source
        && left?.sourceUrl === right?.sourceUrl
        && left?.quality === right?.quality
        && left?.qualityLabel === right?.qualityLabel
        && left?.description === right?.description;
}

/**
 * Resolve the published source availability into the actual automatic route.
 * C01 remains preferred where it overlaps finals2000A, so the agenda exposes
 * a single C01 -> finals -> extrapolation transition instead of a duplicate
 * end marker for each source's independently published horizon. Intervals
 * are half-open `[start, end)` just like the rest of the planner.
 */
export function resolvePlannerEopCoverageIntervals(erpDiagnostic) {
    const sourceSegments = normalizeEopCoverageTimeline(erpDiagnostic);
    const boundaries = [...new Set(sourceSegments.flatMap((segment) => [
        segment.startMs,
        ...(segment.endMs === null ? [] : [segment.endMs])
    ]))].sort((left, right) => left - right);
    if (!boundaries.length) return [];

    const intervals = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const startMs = boundaries[index];
        const endMs = boundaries[index + 1];
        if (endMs <= startMs) continue;
        const selected = eopSegmentAt(sourceSegments, startMs + ((endMs - startMs) / 2));
        if (!selected) continue;
        intervals.push({
            ...selected,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            startMs,
            endMs
        });
    }

    // Nominal fallback is deliberately open-ended in diagnostics. Preserve
    // its actual start without inventing a visual end date; the renderer can
    // present that one transition as a point with `openEnded: true`.
    const lastBoundary = boundaries.at(-1);
    const openEnded = eopSegmentAt(sourceSegments, lastBoundary);
    if (openEnded?.endMs === null) {
        intervals.push({
            ...openEnded,
            start: new Date(lastBoundary).toISOString(),
            end: null,
            startMs: lastBoundary,
            endMs: null
        });
    }

    return intervals.reduce((resolved, interval) => {
        const previous = resolved.at(-1);
        if (previous
            && previous.endMs === interval.startMs
            && sameEopProvenance(previous, interval)) {
            previous.end = interval.end;
            previous.endMs = interval.endMs;
            return resolved;
        }
        resolved.push({ ...interval });
        return resolved;
    }, []);
}

function eopCoverageEventKind(segment) {
    switch (segment?.kind) {
    case EOP_COVERAGE_SOURCE_KINDS.C01:
        return PLANNER_EVENT_KINDS.IERS_C01_COVERAGE;
    case EOP_COVERAGE_SOURCE_KINDS.FINALS:
        return PLANNER_EVENT_KINDS.FINALS2000A_COVERAGE;
    case EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION:
        return PLANNER_EVENT_KINDS.ERP_LINEAR_EXTRAPOLATION;
    case EOP_COVERAGE_SOURCE_KINDS.NOMINAL:
        return PLANNER_EVENT_KINDS.ERP_NOMINAL_FALLBACK;
    default:
        return null;
    }
}

function eopQualityText(segment) {
    return [segment?.quality, segment?.qualityLabel]
        .map(text)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function isPredictedEopQuality(segment) {
    const quality = eopQualityText(segment);
    return quality === "p"
        || /(?:^|[\s/_-])predicted?(?:$|[\s/_-])/.test(quality)
        || /(?:^|[\s/_-])prediction(?:$|[\s/_-])/.test(quality)
        || /(?:^|[\s/_-])forecast(?:$|[\s/_-])/.test(quality);
}

/**
 * Resolve the colour semantic for one selected automatic EOP interval.
 *
 * C01 is Orbit's normal, preferred source and stays green.  finals2000A
 * final/rapid records are valid published data but remain yellow so the
 * operator can see that the route has moved away from C01.  Bulletin A
 * predictions, as well as Orbit's explicit extrapolation and nominal
 * fallback, are red because their uncertainty or degradation needs action.
 */
export function plannerEopCoveragePresentation(segment) {
    switch (segment?.kind) {
    case EOP_COVERAGE_SOURCE_KINDS.C01:
        return Object.freeze({
            visualState: PLANNER_EOP_VISUAL_STATES.NORMAL,
            colorToken: PLANNER_COLOR_TOKENS.EMERALD,
            requiresAttention: false
        });
    case EOP_COVERAGE_SOURCE_KINDS.FINALS:
        if (isPredictedEopQuality(segment)) {
            return Object.freeze({
                visualState: PLANNER_EOP_VISUAL_STATES.PREDICTED,
                colorToken: PLANNER_COLOR_TOKENS.ROSE,
                requiresAttention: true
            });
        }
        return Object.freeze({
            visualState: PLANNER_EOP_VISUAL_STATES.OK,
            colorToken: PLANNER_COLOR_TOKENS.AMBER,
            requiresAttention: false
        });
    case EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION:
    case EOP_COVERAGE_SOURCE_KINDS.NOMINAL:
        return Object.freeze({
            visualState: PLANNER_EOP_VISUAL_STATES.DEGRADED,
            colorToken: PLANNER_COLOR_TOKENS.ROSE,
            requiresAttention: true
        });
    default:
        return Object.freeze({
            visualState: PLANNER_EOP_VISUAL_STATES.DEGRADED,
            colorToken: PLANNER_COLOR_TOKENS.ROSE,
            requiresAttention: true
        });
    }
}

function sameEopVisualPresentation(left, right) {
    return left?.eopPresentation?.visualState === right?.eopPresentation?.visualState
        && left?.eopPresentation?.colorToken === right?.eopPresentation?.colorToken;
}

/**
 * Compact the route selected for the agenda into visual bands.  The provider
 * can legitimately switch from Bulletin B final to Bulletin A rapid records
 * on consecutive days.  Both have the same operator-facing amber state, so
 * publishing them as separate rails would make one continuous availability
 * period look like duplicate events.  Keep the original selected intervals
 * on `eopSegments`; the merger only changes the presentation boundary.
 *
 * Open-ended nominal fallback remains its own point.  Combining a finite
 * interval with an unbounded one would erase the finite source boundary and
 * falsely turn the previous range into a point.
 */
export function mergePlannerEopCoverageIntervals(intervals) {
    if (!Array.isArray(intervals)) return [];
    const ordered = intervals
        .filter((segment) => Number.isFinite(segment?.startMs)
            && (segment?.endMs === null || Number.isFinite(segment?.endMs)))
        .map((segment) => ({
            ...segment,
            eopPresentation: plannerEopCoveragePresentation(segment),
            eopSegments: [{ ...segment }]
        }))
        .sort((left, right) => left.startMs - right.startMs || ((left.endMs ?? Infinity) - (right.endMs ?? Infinity)));

    return ordered.reduce((merged, candidate) => {
        const previous = merged.at(-1);
        if (previous
            && previous.endMs !== null
            && candidate.endMs !== null
            && previous.endMs === candidate.startMs
            && sameEopVisualPresentation(previous, candidate)) {
            previous.end = candidate.end;
            previous.endMs = candidate.endMs;
            previous.eopSegments.push(...candidate.eopSegments);
            return merged;
        }
        merged.push(candidate);
        return merged;
    }, []);
}

function eopSourceName(segment) {
    const source = text(segment?.source);
    if (source) return source;
    switch (segment?.kind) {
    case EOP_COVERAGE_SOURCE_KINDS.C01:
        return "IERS C01";
    case EOP_COVERAGE_SOURCE_KINDS.FINALS:
        return "IERS finals2000A";
    case EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION:
        return "Extrapolación lineal Orbit";
    case EOP_COVERAGE_SOURCE_KINDS.NOMINAL:
        return "Rotación terrestre nominal";
    default:
        return "ERP";
    }
}

function eopCoverageEventDescription(segment) {
    const source = eopSourceName(segment);
    const quality = text(segment?.qualityLabel || segment?.quality);
    const provenance = [source, quality].filter(Boolean).join(" · ");
    if (segment?.kind === EOP_COVERAGE_SOURCE_KINDS.C01) {
        return `Intervalo de orientación terrestre resuelto con IERS C01${provenance ? ` (${provenance})` : ""}. No es una caducidad de fichero.`;
    }
    if (segment?.kind === EOP_COVERAGE_SOURCE_KINDS.FINALS) {
        return `Intervalo de orientación terrestre resuelto con finals2000A${provenance ? ` (${provenance})` : ""}. Conserva su calidad publicada; no es una caducidad de fichero.`;
    }
    if (segment?.kind === EOP_COVERAGE_SOURCE_KINDS.NOMINAL) {
        return "Desde este instante Orbit aplica rotación terrestre nominal. No es una muestra ERP ni un dato IERS y no tiene un fin publicado.";
    }
    return "Intervalo con extrapolación lineal declarada por Orbit. No es una muestra ERP ni un dato IERS.";
}

function uniqueEopText(values) {
    return [...new Set(values.map(text).filter(Boolean))];
}

function eopPublishedSegmentMetadata(segment) {
    const start = plannerIsoTimestamp(segment?.start);
    const end = plannerIsoTimestamp(segment?.end);
    const sourceUrl = text(segment?.sourceUrl);
    const quality = text(segment?.quality);
    const qualityLabel = text(segment?.qualityLabel);
    return {
        kind: text(segment?.kind),
        source: eopSourceName(segment),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(quality ? { quality } : {}),
        ...(qualityLabel ? { qualityLabel } : {}),
        range: {
            start,
            end
        },
        description: eopCoverageEventDescription(segment)
    };
}

function eopMergedCoverageDescription(segment, publishedSegments) {
    if (publishedSegments.length <= 1) return eopCoverageEventDescription(segment);
    const provenance = publishedSegments.map((entry) => {
        const quality = [entry.qualityLabel, entry.quality].filter(Boolean).join(" / ");
        const range = `${entry.range.start || "?"} — ${entry.range.end || "sin fin publicado"}`;
        return [entry.source, quality, range].filter(Boolean).join(" · ");
    }).join("; ");
    return `Banda de orientación terrestre que agrupa ${publishedSegments.length} tramos contiguos con la misma señal operativa. `
        + `La procedencia y calidad de cada tramo se conservan: ${provenance}. No es una caducidad de fichero.`;
}

function eopMergedCoverageTitle(presentation, segment, publishedSegments) {
    if (publishedSegments.length <= 1) {
        const quality = text(segment?.qualityLabel || segment?.quality);
        return `${presentation.label}${quality ? ` · ${quality}` : ""}`;
    }
    switch (segment?.eopPresentation?.visualState) {
    case PLANNER_EOP_VISUAL_STATES.NORMAL:
        return `${presentation.label} · Cobertura de referencia`;
    case PLANNER_EOP_VISUAL_STATES.OK:
        return `${presentation.label} · Calidad publicada`;
    case PLANNER_EOP_VISUAL_STATES.PREDICTED:
        return `${presentation.label} · Predicción publicada`;
    case PLANNER_EOP_VISUAL_STATES.DEGRADED:
        return `${presentation.label} · Cobertura degradada`;
    default:
        return presentation.label;
    }
}

function eopMergedCoverageMetadata(segment, publishedSegments) {
    const sourceKinds = uniqueEopText(publishedSegments.map((entry) => entry.kind));
    const sources = uniqueEopText(publishedSegments.map((entry) => entry.source));
    const sourceUrls = uniqueEopText(publishedSegments.map((entry) => entry.sourceUrl));
    const qualities = uniqueEopText(publishedSegments.map((entry) => entry.quality));
    const qualityLabels = uniqueEopText(publishedSegments.map((entry) => entry.qualityLabel));
    return {
        sourceKind: sourceKinds.length === 1 ? sourceKinds[0] : "mixed",
        sourceKinds,
        source: sources.length === 1 ? sources[0] : "Fuentes EOP combinadas",
        sourceUrl: sourceUrls.length === 1 ? sourceUrls[0] : undefined,
        ...(sourceUrls.length > 1 ? { sourceUrls } : {}),
        ...(qualities.length ? { quality: qualities.join(" / ") } : {}),
        ...(qualityLabels.length ? { qualityLabel: qualityLabels.join(" · ") } : {}),
        eopSegmentCount: publishedSegments.length,
        eopSegments: publishedSegments,
        coverageStart: plannerIsoTimestamp(segment?.start),
        coverageEnd: plannerIsoTimestamp(segment?.end) || null
    };
}

/**
 * Return the synthetic, planner-only EOP layer when diagnostics publish a
 * real source interval. It has one stable id so an operator can hide the
 * whole provenance map without mutating the scene or diagnostics subsystem.
 */
export function buildPlannerEopCoverageLayer(erpDiagnostic) {
    // An open extrapolation without a published horizon cannot honestly be
    // rendered as a range. Do not expose an empty toggle in that malformed
    // diagnostics case; nominal fallback still creates its explicit point.
    if (!buildPlannerEopCoverageEvents(erpDiagnostic).length) return null;
    return {
        id: PLANNER_EOP_LAYER_ID,
        name: "IERS ERP Time",
        type: "SYSTEM",
        sourceId: PLANNER_EOP_LAYER_ID,
        active: true,
        visible: true,
        sourceFormat: "EOP",
        sourceOrigin: "IERS",
        validation: "diagnostics-coverage-timeline"
    };
}

/**
 * Turn the explicit automatic EOP route into agenda intervals. A raw cache
 * timestamp never becomes a calendar fact. Contiguous intervals sharing one
 * visual state publish as one band, while their exact source/quality spans
 * remain in `metadata.eopSegments`. Only the genuinely open-ended nominal
 * fallback is a point because fabricating an end would be misleading.
 */
export function buildPlannerEopCoverageEvents(erpDiagnostic) {
    return normalizePlannerEvents(mergePlannerEopCoverageIntervals(resolvePlannerEopCoverageIntervals(erpDiagnostic)).flatMap((segment) => {
        const kind = eopCoverageEventKind(segment);
        const start = plannerIsoTimestamp(segment.start);
        const end = plannerIsoTimestamp(segment.end);
        if (!kind || !start || (segment.kind !== EOP_COVERAGE_SOURCE_KINDS.NOMINAL && !end)) return [];
        const presentation = PLANNER_EVENT_PRESENTATION[kind];
        const eopPresentation = segment.eopPresentation || plannerEopCoveragePresentation(segment);
        const sourceName = eopSourceName(segment);
        const quality = text(segment.quality);
        const qualityLabel = text(segment.qualityLabel);
        const publishedSegments = (Array.isArray(segment.eopSegments) && segment.eopSegments.length
            ? segment.eopSegments
            : [segment]).map(eopPublishedSegmentMetadata);
        const openEnded = segment.kind === EOP_COVERAGE_SOURCE_KINDS.NOMINAL && !end;
        const event = normalizePlannerEvent({
            id: `eop:${segment.kind}:${start}:${end || "open"}:${eopPresentation.visualState}`,
            source: "eop",
            kind,
            colorToken: eopPresentation.colorToken,
            ...(end ? { start, end } : { time: start }),
            title: eopMergedCoverageTitle(presentation, segment, publishedSegments),
            metadata: {
                layerId: PLANNER_EOP_LAYER_ID,
                sourceId: PLANNER_EOP_LAYER_ID,
                resourceType: "erp",
                eopRange: !openEnded,
                ...(openEnded ? { openEnded: true } : {}),
                sourceKind: segment.kind,
                source: sourceName,
                ...(text(segment.sourceUrl) ? { sourceUrl: text(segment.sourceUrl) } : {}),
                quality,
                ...(qualityLabel ? { qualityLabel } : {}),
                eopVisualState: eopPresentation.visualState,
                eopColorToken: eopPresentation.colorToken,
                requiresAttention: eopPresentation.requiresAttention,
                coverageStart: start,
                coverageEnd: end || null,
                ...eopMergedCoverageMetadata(segment, publishedSegments),
                description: eopMergedCoverageDescription(segment, publishedSegments)
            }
        });
        return event ? [event] : [];
    }));
}

function productErpCoverageRecord(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const id = text(source.id || source.productId || source.snapshotId);
    const start = plannerIsoTimestamp(source.coverageStart ?? source.start ?? source.startTime);
    const end = plannerIsoTimestamp(source.coverageEnd ?? source.end ?? source.endTime);
    if (!id || !start || !end || Date.parse(end) <= Date.parse(start)) return null;
    const sourceIds = [...new Set((Array.isArray(source.sourceIds) ? source.sourceIds : [source.sourceId])
        .map(text)
        .filter(Boolean))];
    return {
        id,
        name: text(source.name) || id,
        coverageStart: start,
        coverageEnd: end,
        sourceIds,
        fileName: text(source.fileName || source.filename || source.file),
        snapshotId: text(source.snapshotId),
        source: text(source.source || source.provider),
        version: text(source.version),
        quality: text(source.quality)
    };
}

/**
 * The product ERP range is a first-class interval, not an IERS fallback or
 * a synthetic validity deadline.  It is rendered by the same continuous
 * coverage rail as automatic EOP, but remains cyan and explicitly labelled
 * so the operator cannot mistake a local SP3 companion for IERS C01.
 */
export function buildPlannerProductErpCoverageEvents(productErpCoverages) {
    return normalizePlannerEvents((Array.isArray(productErpCoverages) ? productErpCoverages : []).flatMap((value) => {
        const coverage = productErpCoverageRecord(value);
        if (!coverage) return [];
        const presentation = PLANNER_EVENT_PRESENTATION[PLANNER_EVENT_KINDS.PRODUCT_ERP_COVERAGE];
        const sourceDetail = coverage.source ? ` de ${coverage.source}` : "";
        const fileDetail = coverage.fileName ? ` (${coverage.fileName})` : "";
        const associatedLayers = coverage.sourceIds.join(", ");
        const event = normalizePlannerEvent({
            id: `product-erp:${coverage.id}:${coverage.coverageStart}:${coverage.coverageEnd}`,
            source: "erp",
            kind: PLANNER_EVENT_KINDS.PRODUCT_ERP_COVERAGE,
            colorToken: presentation.colorToken,
            start: coverage.coverageStart,
            end: coverage.coverageEnd,
            title: `${presentation.label} · ${coverage.name}`,
            metadata: {
                layerId: PLANNER_PRODUCT_ERP_LAYER_ID,
                sourceId: PLANNER_PRODUCT_ERP_LAYER_ID,
                resourceType: "erp",
                eopRange: true,
                sourceKind: "product-erp",
                source: coverage.source || "ERP asociado al producto SP3",
                ...(coverage.fileName ? { fileName: coverage.fileName } : {}),
                ...(coverage.snapshotId ? { snapshotId: coverage.snapshotId } : {}),
                ...(coverage.version ? { version: coverage.version } : {}),
                ...(coverage.quality ? { quality: coverage.quality } : {}),
                ...(coverage.sourceIds.length ? { sourceIds: coverage.sourceIds } : {}),
                eopVisualState: "product-bound",
                eopColorToken: presentation.colorToken,
                requiresAttention: false,
                coverageStart: coverage.coverageStart,
                coverageEnd: coverage.coverageEnd,
                description: `Cobertura UTC verificada del ERP asociado al producto SP3${sourceDetail}${fileDetail}.`
                    + (associatedLayers ? ` Se aplica a: ${associatedLayers}.` : "")
                    + " No utiliza ni prolonga la cadena automática IERS."
            }
        });
        return event ? [event] : [];
    }));
}

/** Publish a hideable, planner-only layer only when an exact product ERP range exists. */
export function buildPlannerProductErpCoverageLayer(productErpCoverages) {
    if (!buildPlannerProductErpCoverageEvents(productErpCoverages).length) return null;
    return {
        id: PLANNER_PRODUCT_ERP_LAYER_ID,
        name: "ERP asociado a SP3",
        type: "SYSTEM",
        sourceId: PLANNER_PRODUCT_ERP_LAYER_ID,
        active: true,
        visible: true,
        sourceFormat: "ERP",
        sourceOrigin: "SP3",
        validation: "product-bound-erp-coverage"
    };
}

function plannerLayerMetadata(layer, description) {
    const metadata = {
        layerId: text(layer?.id),
        sourceId: text(layer?.sourceId),
        sourceFormat: text(layer?.sourceFormat).toUpperCase(),
        sourceOrigin: text(layer?.sourceOrigin).toUpperCase(),
        validation: text(layer?.validation)
    };
    const candidates = [
        ["importFileName", layer?.importFileName],
        ["importedAt", layer?.importedAt],
        ["tleEpoch", layer?.tleEpoch],
        ["validityStart", layer?.validityStart],
        ["validityEnd", layer?.validityEnd],
        ["sourceProvider", layer?.sourceProvider]
    ];
    for (const [key, value] of candidates) {
        const normalized = text(value);
        if (normalized) metadata[key] = normalized;
    }
    if (description) metadata.description = description;
    return metadata;
}

/**
 * Adapt explicit layer provenance into point events.  This intentionally does
 * not guess an import moment from a generic catalogue update or manufacture
 * a TLE validity horizon: only a persisted `importedAt` and a parsed TLE
 * epoch are eligible.  The normalised layer facts are runtime-derived, so
 * these notices are recalculated rather than written into a project.
 */
export function buildPlannerLayerEvents(layers) {
    if (!Array.isArray(layers)) return [];
    return normalizePlannerEvents(layers.flatMap((layer) => {
        const layerId = text(layer?.id);
        const name = text(layer?.name) || layerId;
        if (!layerId || layer?.active !== true) return [];
        const sourceFormat = text(layer?.sourceFormat).toUpperCase();
        const sourceOrigin = text(layer?.sourceOrigin).toUpperCase();
        const importFileName = text(layer?.importFileName);
        const importedAt = plannerIsoTimestamp(layer?.importedAt);
        const tleEpoch = plannerIsoTimestamp(layer?.tleEpoch);
        const events = [];

        if (importedAt) {
            const fileDetail = importFileName ? ` desde ${importFileName}` : "";
            const formatDetail = sourceFormat || "orbital";
            const description = `${formatDetail} incorporado a la escena${fileDetail}.`
                + " La fecha procede del registro de importación local.";
            const event = normalizePlannerEvent({
                id: `layer:${layerId}:imported`,
                source: "layer",
                kind: PLANNER_EVENT_KINDS.LAYER_IMPORTED,
                time: importedAt,
                title: `${PLANNER_EVENT_PRESENTATION[PLANNER_EVENT_KINDS.LAYER_IMPORTED].label} · ${name}`,
                metadata: plannerLayerMetadata(layer, description)
            });
            if (event) events.push(event);
        }

        // Only an actual TLE/OMM-with-TLE epoch is eligible. An SP3/OEM
        // coverage boundary is represented separately as a validity fact.
        if (tleEpoch && ["TLE", "OMM"].includes(sourceFormat)) {
            const originDetail = sourceOrigin ? ` (${sourceOrigin})` : "";
            const description = `Época declarada por el elemento ${sourceFormat}${originDetail}.`
                + " No expresa una fecha de caducidad ni una garantía de precisión.";
            const event = normalizePlannerEvent({
                id: `layer:${layerId}:tle-epoch`,
                source: "layer",
                kind: PLANNER_EVENT_KINDS.TLE_EPOCH,
                time: tleEpoch,
                title: `${PLANNER_EVENT_PRESENTATION[PLANNER_EVENT_KINDS.TLE_EPOCH].label} · ${name}`,
                metadata: plannerLayerMetadata(layer, description)
            });
            if (event) events.push(event);
        }
        return events;
    }));
}

/**
 * A valid planner range is half-open `[start, end)`. This makes adjacent
 * events deterministic and prevents a midnight event appearing in two cells.
 */
export function normalizePlannerRange(rangeOrStart, maybeEnd) {
    const range = rangeOrStart && typeof rangeOrStart === "object" && !(rangeOrStart instanceof Date)
        ? rangeOrStart
        : { start: rangeOrStart, end: maybeEnd };
    const startCandidate = firstPresent(range, ["start", "startTime"]);
    const endCandidate = firstPresent(range, ["end", "endTime"]);
    const startMs = startCandidate.present ? toPlannerEpochMs(startCandidate.value) : null;
    const endMs = endCandidate.present ? toPlannerEpochMs(endCandidate.value) : null;
    if (startMs === null || endMs === null || endMs <= startMs) return null;
    return {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        startMs,
        endMs
    };
}

export function plannerEventIntersectsRange(event, rangeOrStart, maybeEnd) {
    const normalized = normalizePlannerEvent(event);
    const range = normalizePlannerRange(rangeOrStart, maybeEnd);
    if (!normalized || !range) return false;
    if (normalized.isPoint) return normalized.startMs >= range.startMs && normalized.startMs < range.endMs;
    return normalized.startMs < range.endMs && normalized.endMs > range.startMs;
}

export function filterPlannerEventsByRange(events, rangeOrStart, maybeEnd) {
    const range = normalizePlannerRange(rangeOrStart, maybeEnd);
    if (!range) return [];
    return normalizePlannerEvents(events).filter((event) => plannerEventIntersectsRange(event, range));
}

/** Whether two events visually conflict in a day/week time column. */
export function plannerEventsOverlap(left, right) {
    const first = normalizePlannerEvent(left);
    const second = normalizePlannerEvent(right);
    if (!first || !second) return false;
    if (first.isPoint && second.isPoint) return first.startMs === second.startMs;
    if (first.isPoint) return first.startMs >= second.startMs && first.startMs <= second.endMs;
    if (second.isPoint) return second.startMs >= first.startMs && second.startMs <= first.endMs;
    return first.startMs < second.endMs && second.startMs < first.endMs;
}

/** Group events by transitive overlap, preserving chronological order. */
export function getPlannerOverlapGroups(events) {
    const groups = [];
    for (const event of normalizePlannerEvents(events)) {
        const active = groups.at(-1);
        if (active && active.some((candidate) => plannerEventsOverlap(candidate, event))) {
            active.push(event);
        } else {
            groups.push([event]);
        }
    }
    return groups;
}

function layoutOverlapGroup(group, groupIndex) {
    const lanes = [];
    const assigned = [];
    const ordered = [...group].sort((left, right) => (
        left.startMs - right.startMs
        || right.durationMs - left.durationMs
        || left.id.localeCompare(right.id)
    ));
    for (const event of ordered) {
        let lane = lanes.findIndex((laneEvents) => laneEvents.every((candidate) => !plannerEventsOverlap(candidate, event)));
        if (lane < 0) {
            lane = lanes.length;
            lanes.push([]);
        }
        lanes[lane].push(event);
        assigned.push({ event, lane, overlapGroup: groupIndex });
    }
    return assigned.map((entry) => ({ ...entry, laneCount: lanes.length }));
}

/**
 * Return a stable lane/column assignment for overlapping timed events. The
 * widest concurrent group gets a common `laneCount`, which gives a renderer
 * safe, non-overlapping columns without embedding any CSS assumptions.
 */
export function layoutPlannerEventLanes(events) {
    return getPlannerOverlapGroups(events)
        .flatMap((group, index) => layoutOverlapGroup(group, index))
        .sort((left, right) => comparePlannerEvents(left.event, right.event));
}

function utcDayRange(value) {
    const epoch = toPlannerEpochMs(value);
    if (epoch === null) return null;
    const date = new Date(epoch);
    const startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const endMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    return normalizePlannerRange(startMs, endMs);
}

function validWeekStart(value) {
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
}

function layoutEventsForRange(events, range) {
    const duration = range.endMs - range.startMs;
    const visible = filterPlannerEventsByRange(events, range);
    return layoutPlannerEventLanes(visible).map(({ event, lane, laneCount, overlapGroup }) => {
        const layoutStartMs = Math.max(event.startMs, range.startMs);
        const layoutEndMs = event.isPoint
            ? layoutStartMs
            : Math.min(event.endMs, range.endMs);
        return {
            event,
            lane,
            laneCount,
            overlapGroup,
            layoutStartMs,
            layoutEndMs,
            topPercent: ((layoutStartMs - range.startMs) / duration) * 100,
            heightPercent: ((layoutEndMs - layoutStartMs) / duration) * 100,
            leftPercent: (lane / laneCount) * 100,
            widthPercent: 100 / laneCount
        };
    });
}

/** UTC day layout; no browser-local day boundaries are used. */
export function getPlannerDayLayout(events, day) {
    const range = utcDayRange(day);
    if (!range) return null;
    return {
        view: "day",
        range,
        events: layoutEventsForRange(events, range)
    };
}

/** UTC week layout with Monday as the default first day (`weekStartsOn: 1`). */
export function getPlannerWeekLayout(events, anchor, { weekStartsOn = 1 } = {}) {
    const day = utcDayRange(anchor);
    if (!day) return null;
    const weekStart = validWeekStart(weekStartsOn);
    const anchorDay = new Date(day.startMs).getUTCDay();
    const offset = (anchorDay - weekStart + 7) % 7;
    const startMs = day.startMs - offset * DAY_MS;
    const range = normalizePlannerRange(startMs, startMs + 7 * DAY_MS);
    return {
        view: "week",
        range,
        weekStartsOn: weekStart,
        days: Array.from({ length: 7 }, (_, index) => getPlannerDayLayout(events, startMs + index * DAY_MS))
    };
}

/**
 * UTC month grid. Each returned week is complete, so consumers can render a
 * Teams/Google-like fixed-cell grid without calculating local daylight-saving
 * transitions themselves. The grid is at least five and at most six full UTC
 * weeks.
 */
export function getPlannerMonthLayout(events, anchor, { weekStartsOn = 1 } = {}) {
    const epoch = toPlannerEpochMs(anchor);
    if (epoch === null) return null;
    const date = new Date(epoch);
    const monthStartMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const monthEndMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const weekStart = validWeekStart(weekStartsOn);
    const firstWeekday = new Date(monthStartMs).getUTCDay();
    const leadingDays = (firstWeekday - weekStart + 7) % 7;
    const gridStartMs = monthStartMs - leadingDays * DAY_MS;
    const weekCount = Math.max(5, Math.ceil((monthEndMs - gridStartMs) / (7 * DAY_MS)));
    const range = normalizePlannerRange(gridStartMs, gridStartMs + weekCount * 7 * DAY_MS);
    return {
        view: "month",
        range,
        month: {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            start: new Date(monthStartMs).toISOString(),
            end: new Date(monthEndMs).toISOString()
        },
        weekStartsOn: weekStart,
        weeks: Array.from({ length: weekCount }, (_, weekIndex) => ({
            index: weekIndex,
            days: Array.from({ length: 7 }, (_, dayIndex) => {
                const layout = getPlannerDayLayout(events, gridStartMs + (weekIndex * 7 + dayIndex) * DAY_MS);
                const dayDate = new Date(layout.range.startMs);
                return {
                    ...layout,
                    isCurrentMonth: dayDate.getUTCMonth() === date.getUTCMonth()
                        && dayDate.getUTCFullYear() === date.getUTCFullYear()
                };
            })
        }))
    };
}

/**
 * Validate the public DOM payload before a renderer consumes it. Unknown state
 * values become a safe error state; no missing `updatedAt` is replaced with
 * the current time. Valid event facts may still be displayed alongside source
 * errors, allowing the UI to explain a partial refresh.
 */
export function normalizePlannerState(detail = {}) {
    const requestedStatus = text(detail?.status).toLowerCase();
    const status = knownStatuses.has(requestedStatus) ? requestedStatus : "error";
    const statusValid = status === requestedStatus;
    const updatedAt = plannerIsoTimestamp(detail?.updatedAt);
    const suppliedErrors = Array.isArray(detail?.errors)
        ? detail.errors
        : detail?.errors === undefined || detail?.errors === null ? [] : [detail.errors];
    const errors = suppliedErrors.map(text).filter(Boolean);
    if (!statusValid) errors.unshift("Estado del planificador no válido.");
    return {
        status,
        events: statusValid ? normalizePlannerEvents(detail?.events) : [],
        updatedAt,
        updatedAtMs: updatedAt ? Date.parse(updatedAt) : null,
        errors
    };
}

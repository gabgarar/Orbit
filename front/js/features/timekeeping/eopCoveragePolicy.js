/**
 * Earth-orientation coverage contract shared by long-running UI operations.
 *
 * The diagnostics service publishes source facts; this module only normalizes
 * and partitions an explicitly requested UTC interval.  It deliberately does
 * not extend a source range, manufacture a coverage start, or call a source
 * "IERS" after the service has selected its labelled linear extrapolation.
 *
 * Supported diagnostics shapes are additive so an upgraded browser can read
 * a backend during a rolling update:
 *
 * ```js
 * {
 *   coverageTimeline: [{ kind, start, end, source, quality }],
 *   sources: { c01: { coverage: { start, end } }, finals2000A: ... },
 *   selection: { c01Coverage, finalsCoverage, extrapolationStartsAt }
 * }
 * ```
 */

const SOURCE_KINDS = Object.freeze({
    C01: "iers-c01",
    FINALS: "finals2000a",
    EXTRAPOLATION: "linear-extrapolation",
    NOMINAL: "nominal-fallback",
    UNKNOWN: "unknown"
});

const SOURCE_PRIORITY = Object.freeze({
    [SOURCE_KINDS.C01]: 30,
    [SOURCE_KINDS.FINALS]: 20,
    [SOURCE_KINDS.EXTRAPOLATION]: 10,
    [SOURCE_KINDS.NOMINAL]: 5,
    [SOURCE_KINDS.UNKNOWN]: 0
});

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function firstValue(source, keys) {
    const candidate = record(source);
    for (const key of keys) {
        if (candidate[key] !== undefined && candidate[key] !== null && candidate[key] !== "") {
            return candidate[key];
        }
    }
    return undefined;
}

function detailsOf(component) {
    const source = record(component);
    return { ...source, ...record(source.details) };
}

/**
 * Parse only an explicit UTC instant. Local date strings are intentionally
 * rejected: a coverage warning must not change with the browser timezone.
 */
export function eopUtcInstant(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const candidate = text(value);
    if (!candidate || !/(?:Z|[+-]\d\d:\d\d)$/i.test(candidate)) return null;
    const milliseconds = Date.parse(candidate);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/** Normalize a strictly ordered, finite UTC range. */
export function normalizeEopCoverageRange(value) {
    const source = record(value);
    const nested = record(firstValue(source, ["coverage", "validity", "range", "window"]));
    const start = eopUtcInstant(firstValue(nested, [
        "start", "startTime", "start_time", "from", "coverageStart", "coverage_start"
    ]) ?? firstValue(source, [
        "start", "startTime", "start_time", "from", "coverageStart", "coverage_start"
    ]));
    const end = eopUtcInstant(firstValue(nested, [
        "end", "endTime", "end_time", "to", "coverageEnd", "coverage_end"
    ]) ?? firstValue(source, [
        "end", "endTime", "end_time", "to", "coverageEnd", "coverage_end"
    ]));
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return null;
    return Object.freeze({
        start,
        end,
        startMs: Date.parse(start),
        endMs: Date.parse(end)
    });
}

function normalizeKind(value) {
    const compact = text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (["iersc01", "c01", "eopc01", "ierscombinedc01"].includes(compact)) {
        return SOURCE_KINDS.C01;
    }
    if (["finals2000a", "finals", "iersfinals2000a", "finals2000"].includes(compact)) {
        return SOURCE_KINDS.FINALS;
    }
    if (["linearextrapolation", "extrapolation", "linear", "fallbacklinear"].includes(compact)) {
        return SOURCE_KINDS.EXTRAPOLATION;
    }
    if (["nominalfallback", "nominal", "nominalrotation", "visualapproximation"].includes(compact)) {
        return SOURCE_KINDS.NOMINAL;
    }
    return "";
}

function sourceInstant(source, keys) {
    const recordValue = record(source);
    const nested = record(firstValue(recordValue, ["coverage", "validity", "range", "window"]));
    return eopUtcInstant(firstValue(nested, keys) ?? firstValue(recordValue, keys));
}

function boundedEndFromHorizon(start, source) {
    const rawDays = firstValue(record(source), [
        "maxHorizonDays", "max_horizon_days", "linearExtrapolationMaxDays", "linear_extrapolation_max_days"
    ]);
    const days = Number(rawDays);
    if (!start || !Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.parse(start) + (days * 24 * 60 * 60 * 1000)).toISOString();
}

function sourceDescriptor(kind, value, defaults = {}) {
    const source = record(value);
    const range = normalizeEopCoverageRange(source);
    const start = range?.start || sourceInstant(source, [
        "start", "startTime", "start_time", "from", "coverageStart", "coverage_start", "startsAfter", "starts_after"
    ]);
    const allowsOpenEnd = kind === SOURCE_KINDS.EXTRAPOLATION || kind === SOURCE_KINDS.NOMINAL;
    const explicitEnd = range?.end || sourceInstant(source, [
        "end", "endTime", "end_time", "to", "coverageEnd", "coverage_end", "endsAt", "ends_at",
        "extrapolationEndsAt", "extrapolation_ends_at"
    ]);
    const end = explicitEnd || (kind === SOURCE_KINDS.EXTRAPOLATION ? boundedEndFromHorizon(start, source) : null);
    // Exact sources need both declared endpoints. Extrapolation may be open
    // only when diagnostics explicitly omit its bound; a published end (for
    // example the 30-day policy horizon) is always respected.
    if (!start || (!allowsOpenEnd && !end) || (end && Date.parse(end) <= Date.parse(start))) {
        return null;
    }
    const quality = text(firstValue(source, ["quality", "status", "class"]))
        || text(firstValue(source, ["qualityLabel", "quality_label"]))
        || defaults.quality || "";
    const qualityLabel = text(firstValue(source, ["qualityLabel", "quality_label"]))
        || defaults.qualityLabel || "";
    return {
        kind,
        start,
        end,
        startMs: Date.parse(start),
        endMs: end ? Date.parse(end) : null,
        source: text(firstValue(source, ["source", "provider", "label", "name"])) || defaults.source || "",
        sourceUrl: text(firstValue(source, ["sourceUrl", "source_url", "url", "uri"])) || defaults.sourceUrl || "",
        quality,
        qualityLabel,
        description: text(firstValue(source, ["description", "details", "detail", "message"])) || defaults.description || "",
        precedence: Number.isFinite(Number(defaults.precedence)) ? Number(defaults.precedence) : 0
    };
}

function segmentFromTimelineEntry(entry) {
    const source = record(entry);
    const kind = normalizeKind(firstValue(source, ["kind", "type", "sourceKind", "source_kind", "id"]));
    if (!kind) return null;
    return sourceDescriptor(kind, source, { precedence: 2 });
}

function descriptorFromNamedSource(kind, source, selection = {}) {
    const defaults = kind === SOURCE_KINDS.C01
        ? { source: "IERS C01", quality: "final" }
        : kind === SOURCE_KINDS.FINALS
            ? { source: "IERS finals2000A" }
            : kind === SOURCE_KINDS.NOMINAL
                ? { source: "Rotación terrestre nominal", quality: "approximate" }
                : { source: "Extrapolación lineal", quality: "extrapolated" };
    const namedRange = kind === SOURCE_KINDS.C01
        ? firstValue(selection, ["c01Coverage", "c01_coverage", "iersC01Coverage", "iers_c01_coverage"])
        : kind === SOURCE_KINDS.FINALS
            ? firstValue(selection, ["finalsCoverage", "finals_coverage", "finals2000ACoverage", "finals2000a_coverage"])
            : null;
    const original = record(source);
    // Selection coverage is useful when the source descriptor only carries
    // provenance. Preserve source quality/label while taking explicit bounds.
    const combined = namedRange && typeof namedRange === "object"
        ? { ...original, coverage: original.coverage || namedRange }
        : original;
    return sourceDescriptor(kind, combined, defaults);
}

function extrapolationFromSelection(selection) {
    const start = sourceInstant(selection, [
        "extrapolationStartsAt", "extrapolation_starts_at", "linearExtrapolationStartsAt", "linear_extrapolation_starts_at",
        "extrapolationStartsAfter", "extrapolation_starts_after", "linearExtrapolationStartsAfter", "linear_extrapolation_starts_after"
    ]);
    if (!start) return null;
    return sourceDescriptor(SOURCE_KINDS.EXTRAPOLATION, {
        start,
        end: firstValue(selection, [
            "extrapolationEndsAt", "extrapolation_ends_at", "linearExtrapolationEndsAt", "linear_extrapolation_ends_at",
            "nominalFallbackStartsAt", "nominal_fallback_starts_at"
        ]),
        maxHorizonDays: firstValue(selection, [
            "linearExtrapolationMaxDays", "linear_extrapolation_max_days", "maxHorizonDays", "max_horizon_days"
        ]),
        source: "Extrapolación lineal",
        quality: "extrapolated"
    });
}

function nominalFallbackFromSelection(selection) {
    const start = sourceInstant(selection, [
        "nominalFallbackStartsAt", "nominal_fallback_starts_at", "nominalStartsAt", "nominal_starts_at"
    ]);
    if (!start) return null;
    return sourceDescriptor(SOURCE_KINDS.NOMINAL, {
        start,
        source: "Rotación terrestre nominal",
        quality: "approximate"
    });
}

function dedupeSegments(segments) {
    const seen = new Set();
    return segments
        .filter(Boolean)
        .sort((left, right) => (
            left.startMs - right.startMs
            || SOURCE_PRIORITY[right.kind] - SOURCE_PRIORITY[left.kind]
            || (right.precedence || 0) - (left.precedence || 0)
            || String(left.end || "").localeCompare(String(right.end || ""))
        ))
        .filter((segment) => {
            const key = [segment.kind, segment.start, segment.end || ""].join("|");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function selectionFallbackBound(selection) {
    const explicit = sourceInstant(selection, [
        "extrapolationEndsAt", "extrapolation_ends_at", "linearExtrapolationEndsAt", "linear_extrapolation_ends_at",
        "nominalFallbackStartsAt", "nominal_fallback_starts_at"
    ]);
    return explicit;
}

function constrainTimelineFallbacks(segments, selection) {
    const selectionExtrapolation = extrapolationFromSelection(selection);
    const bound = selectionFallbackBound(selection) || selectionExtrapolation?.end || null;
    if (!bound) return segments.filter(Boolean);
    const boundMs = Date.parse(bound);
    return segments.filter(Boolean).flatMap((segment) => {
        if (segment.kind !== SOURCE_KINDS.EXTRAPOLATION) return [segment];
        if (segment.startMs >= boundMs) return [];
        if (segment.endMs !== null && segment.endMs <= boundMs) return [segment];
        return [{ ...segment, end: bound, endMs: boundMs }];
    });
}

/**
 * Extract factual EOP source intervals from the diagnostic component. Unknown
 * or malformed input returns no segments rather than a guessed fallback.
 */
export function normalizeEopCoverageTimeline(component) {
    const details = detailsOf(component);
    const timeline = firstValue(details, [
        "coverageTimeline", "coverage_timeline", "eopCoverageTimeline", "eop_coverage_timeline"
    ]);
    const timelineSegments = (Array.isArray(timeline) ? timeline : [])
        .map(segmentFromTimelineEntry)
        .filter(Boolean);
    const sources = record(firstValue(details, ["sources", "eopSources", "eop_sources"]));
    const selection = record(firstValue(details, ["selection", "eopSelection", "eop_selection"]));
    const namedSegments = [
        descriptorFromNamedSource(SOURCE_KINDS.C01, firstValue(sources, ["c01", "iersC01", "iers_c01"]), selection),
        descriptorFromNamedSource(SOURCE_KINDS.FINALS, firstValue(sources, ["finals2000A", "finals2000a", "finals", "iersFinals2000A"]), selection),
        descriptorFromNamedSource(SOURCE_KINDS.NOMINAL, firstValue(sources, ["nominalFallback", "nominal_fallback", "nominal"]), selection),
        extrapolationFromSelection(selection),
        nominalFallbackFromSelection(selection)
    ];
    return Object.freeze(dedupeSegments(constrainTimelineFallbacks(
        [...timelineSegments, ...namedSegments],
        selection
    )).map((segment) => Object.freeze(segment)));
}

function segmentAt(timeline, midpoint) {
    return timeline
        .filter((segment) => segment.startMs <= midpoint && (segment.endMs === null || midpoint < segment.endMs))
        .sort((left, right) => (
            SOURCE_PRIORITY[right.kind] - SOURCE_PRIORITY[left.kind]
            || (right.precedence || 0) - (left.precedence || 0)
        ))[0] || null;
}

function rangeFromAny(value) {
    if (!value || typeof value !== "object") return null;
    return normalizeEopCoverageRange(value);
}

function mergedAdjacentSegments(segments) {
    return segments.reduce((result, candidate) => {
        const previous = result.at(-1);
        if (previous
            && previous.kind === candidate.kind
            && previous.source === candidate.source
            && previous.quality === candidate.quality
            && previous.endMs === candidate.startMs) {
            previous.end = candidate.end;
            previous.endMs = candidate.endMs;
            return result;
        }
        result.push({ ...candidate });
        return result;
    }, []);
}

function classificationForPartition(partition) {
    const hasC01 = partition.some((segment) => segment.kind === SOURCE_KINDS.C01);
    const hasFinals = partition.some((segment) => segment.kind === SOURCE_KINDS.FINALS);
    const hasExtrapolation = partition.some((segment) => segment.kind === SOURCE_KINDS.EXTRAPOLATION);
    const hasNominal = partition.some((segment) => segment.kind === SOURCE_KINDS.NOMINAL);
    const hasUnknown = partition.some((segment) => segment.kind === SOURCE_KINDS.UNKNOWN);
    const classification = hasUnknown || hasExtrapolation || hasNominal
        ? (hasC01 || hasFinals ? "mixed" : hasExtrapolation ? "extrapolated" : hasNominal ? "nominal" : "unknown")
        : hasFinals
            ? (hasC01 ? "mixed-exact" : "finals2000a")
            : hasC01
                ? "iers-c01"
                : "unknown";
    return {
        classification,
        hasC01,
        hasFinals,
        hasExtrapolation,
        hasNominal,
        hasUnknown
    };
}

/**
 * Normalize actual per-operation provenance returned by a backend route.
 * Unlike `assessEarthOrientationCoverage`, the service already chose the
 * routes used for this exact request, so no source timeline is inferred.
 */
export function normalizeEarthOrientationWindow(value) {
    const payload = record(value);
    const segments = (Array.isArray(payload.segments) ? payload.segments : [])
        .map((entry) => {
            const source = record(entry);
            const kind = normalizeKind(firstValue(source, ["kind", "type", "sourceKind", "source_kind"]));
            const start = sourceInstant(source, ["start", "startTime", "start_time", "from"]);
            const end = sourceInstant(source, ["end", "endTime", "end_time", "to"]);
            if (!kind || !start || !end || Date.parse(end) < Date.parse(start)) return null;
            return {
                kind,
                start,
                end,
                startMs: Date.parse(start),
                endMs: Date.parse(end),
                source: text(firstValue(source, ["source", "provider", "label", "name"])),
                quality: text(firstValue(source, ["quality", "qualityLabel", "quality_label", "status", "class"])),
                description: text(firstValue(source, ["description", "details", "detail", "message"]))
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
    if (!segments.length) return null;
    const partition = mergedAdjacentSegments(segments);
    const classified = classificationForPartition(partition);
    const rangeStart = sourceInstant(payload, ["start", "startTime", "start_time", "from"])
        || partition[0].start;
    const rangeEnd = sourceInstant(payload, ["end", "endTime", "end_time", "to"])
        || partition.at(-1).end;
    return Object.freeze({
        available: true,
        validRange: Boolean(rangeStart && rangeEnd && Date.parse(rangeEnd) >= Date.parse(rangeStart)),
        range: rangeStart && rangeEnd ? {
            start: rangeStart,
            end: rangeEnd,
            startMs: Date.parse(rangeStart),
            endMs: Date.parse(rangeEnd)
        } : null,
        timeline: Object.freeze([]),
        segments: Object.freeze(partition.map((segment) => Object.freeze(segment))),
        ...classified,
        requiresNotice: classified.classification !== "iers-c01" || payload.requiresAttention === true,
        requiresWarning: classified.hasExtrapolation || classified.hasNominal || classified.hasUnknown
    });
}

/**
 * Partition an operation's requested interval into C01, finals2000A,
 * extrapolation, nominal fallback, and genuinely unknown portions. Interval boundaries are
 * half-open `[start, end)`, matching propagator sampling contracts.
 */
export function assessEarthOrientationCoverage(component, requestedRange) {
    const range = rangeFromAny(requestedRange);
    const timeline = normalizeEopCoverageTimeline(component);
    if (!range) {
        return Object.freeze({
            available: timeline.length > 0,
            validRange: false,
            range: null,
            timeline,
            segments: Object.freeze([]),
            classification: "invalid",
            requiresNotice: false,
            requiresWarning: false,
            hasC01: false,
            hasFinals: false,
            hasExtrapolation: false,
            hasUnknown: false
        });
    }
    if (!timeline.length) {
        return Object.freeze({
            available: false,
            validRange: true,
            range,
            timeline,
            segments: Object.freeze([Object.freeze({
                kind: SOURCE_KINDS.UNKNOWN,
                start: range.start,
                end: range.end,
                startMs: range.startMs,
                endMs: range.endMs,
                source: "",
                quality: "",
                description: ""
            })]),
            classification: "unknown",
            requiresNotice: true,
            requiresWarning: true,
            hasC01: false,
            hasFinals: false,
            hasExtrapolation: false,
            hasUnknown: true
        });
    }

    const boundarySet = new Set([range.startMs, range.endMs]);
    timeline.forEach((segment) => {
        if (segment.startMs > range.startMs && segment.startMs < range.endMs) boundarySet.add(segment.startMs);
        if (segment.endMs !== null && segment.endMs > range.startMs && segment.endMs < range.endMs) boundarySet.add(segment.endMs);
    });
    const boundaries = [...boundarySet].sort((left, right) => left - right);
    const segments = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const startMs = boundaries[index];
        const endMs = boundaries[index + 1];
        const resolved = segmentAt(timeline, startMs + ((endMs - startMs) / 2));
        segments.push({
            kind: resolved?.kind || SOURCE_KINDS.UNKNOWN,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            startMs,
            endMs,
            source: resolved?.source || "",
            quality: resolved?.quality || "",
            description: resolved?.description || ""
        });
    }
    const partition = mergedAdjacentSegments(segments);
    const classified = classificationForPartition(partition);
    return Object.freeze({
        available: true,
        validRange: true,
        range,
        timeline,
        segments: Object.freeze(partition.map((segment) => Object.freeze(segment))),
        ...classified,
        // finals2000A may legitimately contain rapid/predicted records. It
        // is still an EOP source, but deserves an operator-visible notice.
        requiresNotice: classified.classification !== "iers-c01",
        requiresWarning: classified.hasExtrapolation || classified.hasNominal || classified.hasUnknown
    });
}

export function earthOrientationSegmentLabel(segment) {
    switch (segment?.kind) {
    case SOURCE_KINDS.C01:
        return "IERS C01";
    case SOURCE_KINDS.FINALS:
        return "finals2000A";
    case SOURCE_KINDS.EXTRAPOLATION:
        return "extrapolación lineal (no ERP/IERS)";
    case SOURCE_KINDS.NOMINAL:
        return "rotación terrestre nominal (sin ERP)";
    default:
        return "cobertura EOP no declarada";
    }
}

function compactUtc(iso) {
    const value = eopUtcInstant(iso);
    return value ? value.replace(".000Z", "Z") : "?";
}

/**
 * Spanish operator copy for banners and the operation ledger. It includes
 * every sub-range so a partial crossing is not collapsed into a vague status.
 */
export function describeEarthOrientationCoverage(assessment, { operation = "La operación" } = {}) {
    if (!assessment?.validRange) {
        return `${operation} no tiene una ventana UTC válida para comprobar la orientación terrestre.`;
    }
    if (!assessment.available) {
        return `${operation}: no hay cobertura EOP publicada para la ventana solicitada; no se puede declarar si se usará IERS C01, finals2000A o extrapolación.`;
    }
    const ranges = (assessment.segments || []).map((segment) => {
        const quality = text(segment.quality);
        return `${earthOrientationSegmentLabel(segment)}${quality ? ` (${quality})` : ""}: ${compactUtc(segment.start)} — ${compactUtc(segment.end)}`;
    });
    if (assessment.classification === "iers-c01") {
        return `${operation}: toda la ventana queda dentro de IERS C01 (${ranges.join("; ")}).`;
    }
    const prefix = assessment.hasExtrapolation || assessment.hasNominal || assessment.hasUnknown
        ? `${operation}: parte de la ventana queda fuera de la cobertura EOP publicada.`
        : `${operation}: la ventana usa finals2000A además de IERS C01.`;
    return `${prefix} ${ranges.join("; ")}.`;
}

/**
 * Render the compact cross-window detail carried in UI/result events. It
 * accepts both the public `{ startTime, endTime }` spelling and the backend
 * `{ start, end }` spelling so result consumers do not need to guess a
 * provenance route from unrelated frame metadata.
 */
export function describeEarthOrientationCoverageDetail(detail, options = {}) {
    const source = record(detail);
    const segments = (Array.isArray(source.segments) ? source.segments : [])
        .map((segment) => {
            const kind = normalizeKind(segment?.kind) || SOURCE_KINDS.UNKNOWN;
            const start = eopUtcInstant(segment?.start ?? segment?.startTime);
            const end = eopUtcInstant(segment?.end ?? segment?.endTime);
            if (!start || !end || Date.parse(end) < Date.parse(start)) return null;
            return {
                kind,
                start,
                end,
                startMs: Date.parse(start),
                endMs: Date.parse(end),
                source: text(segment?.source),
                quality: text(segment?.quality),
                description: ""
            };
        })
        .filter(Boolean);
    if (!segments.length) return "";
    const classified = classificationForPartition(segments);
    return describeEarthOrientationCoverage({
        available: true,
        validRange: true,
        segments,
        classification: text(source.classification) || classified.classification,
        hasExtrapolation: source.hasExtrapolation === true || classified.hasExtrapolation,
        hasNominal: source.hasNominal === true || classified.hasNominal,
        hasUnknown: source.hasUnknown === true || classified.hasUnknown
    }, options);
}

/** Stable, serialisable subset used in result/context events. */
export function earthOrientationCoverageDetail(assessment) {
    if (!assessment?.validRange) return null;
    return {
        classification: assessment.classification,
        requiresNotice: assessment.requiresNotice === true,
        requiresWarning: assessment.requiresWarning === true,
        hasC01: assessment.hasC01 === true,
        hasFinals: assessment.hasFinals === true,
        hasExtrapolation: assessment.hasExtrapolation === true,
        hasNominal: assessment.hasNominal === true,
        hasUnknown: assessment.hasUnknown === true,
        range: assessment.range ? { startTime: assessment.range.start, endTime: assessment.range.end } : null,
        segments: (assessment.segments || []).map((segment) => ({
            kind: segment.kind,
            startTime: segment.start,
            endTime: segment.end,
            source: segment.source || "",
            quality: segment.quality || ""
        }))
    };
}

export { SOURCE_KINDS as EOP_COVERAGE_SOURCE_KINDS };

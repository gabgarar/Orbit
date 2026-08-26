/**
 * Project-owned propagation audit trail.
 *
 * The activity ledger intentionally contains only live operations. This
 * contract records the compact, reproducible summary of an ephemerides
 * request after it has started, without retaining response samples or source
 * files. It is safe to place in a portable .orbit document and to show after
 * a project has been reopened on another local installation.
 */

export const PROPAGATION_HISTORY_STATUSES = Object.freeze({
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "cancelled"
});

// A project history is audit metadata, not an unbounded secondary cache.
// Retaining the latest 200 executions is ample for a local operational
// session while keeping encrypted project saves and portable exports bounded.
export const MAX_PROJECT_PROPAGATION_HISTORY_ENTRIES = 200;

const KNOWN_STATUSES = new Set(Object.values(PROPAGATION_HISTORY_STATUSES));
const MAX_IDENTIFIER_LENGTH = 180;
const MAX_TEXT_LENGTH = 720;

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maximum = MAX_TEXT_LENGTH) {
    if (value === undefined || value === null) return "";
    return String(value).trim().slice(0, maximum);
}

function nullableText(value, maximum = MAX_TEXT_LENGTH) {
    const normalized = text(value, maximum);
    return normalized || null;
}

function isoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function positiveInteger(value) {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? Math.floor(number) : null;
}

function normalizeStatus(value) {
    const status = text(value, 32).toLowerCase();
    return KNOWN_STATUSES.has(status) ? status : PROPAGATION_HISTORY_STATUSES.RUNNING;
}

function normalizeTarget(value, fallback = {}) {
    const source = record(value);
    const fallbackTarget = record(fallback);
    const id = nullableText(source.id ?? source.targetId ?? fallbackTarget.id ?? fallbackTarget.targetId, MAX_IDENTIFIER_LENGTH);
    const name = nullableText(source.name ?? source.targetName ?? fallbackTarget.name ?? fallbackTarget.targetName, MAX_IDENTIFIER_LENGTH);
    if (!id && !name) return null;
    return { id, name: name || id };
}

function normalizeRange(value, fallback = {}) {
    const source = record(value);
    const fallbackRange = record(fallback);
    const startTime = isoDate(source.startTime ?? source.start_time ?? source.start ?? fallbackRange.startTime ?? fallbackRange.start_time ?? fallbackRange.start);
    const endTime = isoDate(source.endTime ?? source.end_time ?? source.end ?? fallbackRange.endTime ?? fallbackRange.end_time ?? fallbackRange.end);
    const mode = nullableText(source.mode ?? fallbackRange.mode, 64);
    const normalized = {
        ...(mode ? { mode } : {}),
        ...(startTime ? { startTime } : {}),
        ...(endTime ? { endTime } : {})
    };
    return Object.keys(normalized).length ? normalized : null;
}

function normalizeSampling(value, fallback = {}) {
    const source = record(value);
    const fallbackSampling = record(fallback);
    const mode = nullableText(source.mode ?? fallbackSampling.mode, 64);
    const requestedIntervalSeconds = finiteNumber(
        source.requestedIntervalSeconds
        ?? source.requested_interval_seconds
        ?? fallbackSampling.requestedIntervalSeconds
        ?? fallbackSampling.requested_interval_seconds
    );
    const effectiveIntervalSeconds = finiteNumber(
        source.effectiveIntervalSeconds
        ?? source.effective_interval_seconds
        ?? fallbackSampling.effectiveIntervalSeconds
        ?? fallbackSampling.effective_interval_seconds
    );
    const sampleCount = positiveInteger(
        source.sampleCount
        ?? source.sample_count
        ?? fallbackSampling.sampleCount
        ?? fallbackSampling.sample_count
    );
    const limited = source.limited === true || fallbackSampling.limited === true;
    const normalized = {
        ...(mode ? { mode } : {}),
        ...(requestedIntervalSeconds !== null ? { requestedIntervalSeconds } : {}),
        ...(effectiveIntervalSeconds !== null ? { effectiveIntervalSeconds } : {}),
        ...(sampleCount !== null ? { sampleCount } : {}),
        ...(limited ? { limited: true } : {})
    };
    return Object.keys(normalized).length ? normalized : null;
}

function normalizeResult(value, fallback = {}) {
    const source = record(value);
    const fallbackResult = record(fallback);
    const sampleCount = positiveInteger(source.sampleCount ?? source.sample_count ?? fallbackResult.sampleCount ?? fallbackResult.sample_count);
    const outputFrame = nullableText(source.outputFrame ?? source.output_frame ?? fallbackResult.outputFrame ?? fallbackResult.output_frame, 64);
    const nativeFrame = nullableText(source.nativeFrame ?? source.native_frame ?? fallbackResult.nativeFrame ?? fallbackResult.native_frame, 64);
    const calculationFrame = nullableText(source.calculationFrame ?? source.calculation_frame ?? fallbackResult.calculationFrame ?? fallbackResult.calculation_frame, 64);
    const normalized = {
        ...(sampleCount !== null ? { sampleCount } : {}),
        ...(outputFrame ? { outputFrame } : {}),
        ...(nativeFrame ? { nativeFrame } : {}),
        ...(calculationFrame ? { calculationFrame } : {})
    };
    return Object.keys(normalized).length ? normalized : null;
}

function normalizedEntry(value, { fallback = {}, now = new Date() } = {}) {
    const source = record(value);
    const prior = record(fallback);
    const id = nullableText(source.id ?? prior.id, MAX_IDENTIFIER_LENGTH);
    if (!id) return null;
    const status = normalizeStatus(source.status ?? prior.status);
    const startedAt = isoDate(source.startedAt ?? source.started_at ?? prior.startedAt ?? prior.started_at) || isoDate(now);
    const updatedAt = isoDate(source.updatedAt ?? source.updated_at ?? prior.updatedAt ?? prior.updated_at) || startedAt;
    const finishedAt = isoDate(source.finishedAt ?? source.finished_at ?? prior.finishedAt ?? prior.finished_at);
    const target = normalizeTarget(source.target, {
        ...prior.target,
        id: source.targetId ?? source.target_id ?? prior.targetId ?? prior.target_id,
        name: source.targetName ?? source.target_name ?? prior.targetName ?? prior.target_name
    });
    const range = normalizeRange(source.range, prior.range);
    const sampling = normalizeSampling(source.sampling, prior.sampling);
    const result = normalizeResult(source.result, prior.result);
    const sourceFormat = nullableText(source.source ?? source.sourceFormat ?? source.source_format ?? prior.source ?? prior.sourceFormat ?? prior.source_format, 80);
    const propagator = nullableText(source.propagator ?? source.model ?? prior.propagator ?? prior.model, 120);
    const requestedOutputFrame = nullableText(source.requestedOutputFrame ?? source.requested_output_frame ?? prior.requestedOutputFrame ?? prior.requested_output_frame, 64);
    const message = nullableText(source.message ?? prior.message);
    const error = nullableText(source.error ?? prior.error);
    return {
        id,
        status,
        startedAt,
        updatedAt,
        ...(finishedAt ? { finishedAt } : {}),
        ...(target ? { target } : {}),
        ...(sourceFormat ? { source: sourceFormat } : {}),
        ...(propagator ? { propagator } : {}),
        ...(range ? { range } : {}),
        ...(sampling ? { sampling } : {}),
        ...(requestedOutputFrame ? { requestedOutputFrame } : {}),
        ...(result ? { result } : {}),
        ...(message ? { message } : {}),
        ...(error ? { error } : {})
    };
}

function timestamp(entry) {
    return Date.parse(entry?.updatedAt || entry?.startedAt || "") || 0;
}

/**
 * Canonical project serialization. Unknown payloads (especially samples and
 * raw backend results) are intentionally discarded so an audit row cannot
 * accidentally turn into another ephemerides cache.
 */
export function normalizePropagationHistory(value, { now = new Date() } = {}) {
    if (!Array.isArray(value)) return [];
    const byId = new Map();
    for (const candidate of value) {
        const normalized = normalizedEntry(candidate, { now });
        if (normalized) byId.set(normalized.id, normalized);
    }
    return [...byId.values()]
        .sort((left, right) => timestamp(right) - timestamp(left))
        .slice(0, MAX_PROJECT_PROPAGATION_HISTORY_ENTRIES);
}

export function createPropagationHistoryEntry(value, { now = new Date() } = {}) {
    return normalizedEntry(value, { now });
}

/** Update a single row while preserving the rest of the project audit. */
export function updatePropagationHistoryEntry(history, id, patch = {}, { now = new Date() } = {}) {
    const normalizedId = nullableText(id, MAX_IDENTIFIER_LENGTH);
    const current = normalizePropagationHistory(history, { now });
    if (!normalizedId) return current;
    const existing = current.find((entry) => entry.id === normalizedId);
    if (!existing) return current;
    const next = normalizedEntry({
        ...record(patch),
        id: normalizedId,
        updatedAt: record(patch).updatedAt ?? isoDate(now),
        target: { ...record(existing.target), ...record(record(patch).target) },
        range: { ...record(existing.range), ...record(record(patch).range) },
        sampling: { ...record(existing.sampling), ...record(record(patch).sampling) },
        result: { ...record(existing.result), ...record(record(patch).result) }
    }, { fallback: existing, now });
    return normalizePropagationHistory([
        ...current.filter((entry) => entry.id !== normalizedId),
        next
    ], { now });
}

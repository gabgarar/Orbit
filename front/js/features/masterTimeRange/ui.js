/**
 * UI contract for Master Time Range decisions.
 *
 * The time-range store remains the authority for accepting an object and for
 * mutating the MTR.  This module only mediates the one explicit decision that
 * may expand it, keeping importers and generators independent from React.
 */

export const MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT = "orbit:master-time-range-expand-request";
export const MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT = "orbit:master-time-range-expand-response";
export const MASTER_TIME_RANGE_OUT_OF_RANGE_STATUS = "out_of_range";
export const MASTER_TIME_RANGE_EXPAND_MESSAGE = "Este objeto está fuera del rango de simulación. ¿Desea ampliar el rango temporal maestro?";
export const MASTER_TIME_RANGE_OUT_OF_RANGE_MESSAGE = "Este objeto no tiene datos para la época actual.";
export const MASTER_TIME_RANGE_DIALOG_READY_KEY = "__orbitMasterTimeRangeDialogReady";
export const MASTER_TIME_RANGE_PENDING_REQUESTS_KEY = "__orbitPendingMasterTimeRangeRequests";

function text(value) {
    return String(value ?? "").trim();
}

function finiteTime(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Date.parse(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : null;
}

function normaliseRange(value) {
    if (!value || typeof value !== "object") return null;
    const startMs = finiteTime(value.startMs ?? value.startDate ?? value.startTime ?? value.start_time
        ?? value.coverageStart ?? value.coverage_start ?? value.start ?? value.min ?? value.t_min);
    const endMs = finiteTime(value.endMs ?? value.endDate ?? value.endTime ?? value.end_time
        ?? value.coverageEnd ?? value.coverage_end ?? value.stopTime ?? value.stop_time ?? value.end ?? value.max ?? value.t_max);
    if (startMs === null || endMs === null || endMs < startMs) return null;
    return {
        startMs,
        endMs,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString()
    };
}

function requestId() {
    return `master-time-range-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEvent(target, type, detail) {
    const CustomEventConstructor = target?.CustomEvent ?? globalThis.CustomEvent;
    if (typeof CustomEventConstructor === "function") return new CustomEventConstructor(type, { detail });
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail });
    return event;
}

/**
 * Normalise an expansion request before it crosses the legacy/React boundary.
 * `range` is presentation metadata only: the caller must revalidate it in the
 * MTR store immediately after the user chooses to expand.
 */
export function createMasterTimeRangeExpansionRequest(request = {}) {
    const source = request && typeof request === "object" ? request : {};
    return {
        id: text(source.id) || requestId(),
        title: text(source.title) || "Ampliar rango temporal maestro",
        message: text(source.message) || MASTER_TIME_RANGE_EXPAND_MESSAGE,
        objectName: text(source.objectName ?? source.name),
        range: normaliseRange(source.range ?? source.objectRange),
        masterRange: normaliseRange(source.masterRange),
        expandLabel: text(source.expandLabel) || "Ampliar",
        cancelLabel: text(source.cancelLabel) || "Cancelar"
    };
}

/**
 * Ask the mounted React dialog for an explicit expand/cancel decision.
 *
 * Failing to reach a dialog deliberately resolves to `cancel`: import and
 * generation workflows must never enlarge the MTR without user consent.
 */
export function requestMasterTimeRangeExpansion(request = {}, {
    target = globalThis.window,
    signal
} = {}) {
    const detail = createMasterTimeRangeExpansionRequest(request);
    if (!target?.addEventListener || !target?.dispatchEvent) {
        return Promise.resolve({ ...detail, decision: "cancel", accepted: false, reason: "dialog-unavailable" });
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (response = {}) => {
            if (settled) return;
            settled = true;
            target.removeEventListener(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, onResponse);
            signal?.removeEventListener?.("abort", onAbort);
            const pending = target === globalThis.window && Array.isArray(target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY])
                ? target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY]
                : null;
            if (pending) {
                const index = pending.findIndex((item) => item?.id === detail.id);
                if (index >= 0) pending.splice(index, 1);
            }
            const decision = response.decision === "expand" ? "expand" : "cancel";
            resolve({ ...detail, decision, accepted: decision === "expand", reason: text(response.reason) || undefined });
        };
        const onResponse = (event) => {
            if (event.detail?.id !== detail.id) return;
            finish(event.detail);
        };
        const onAbort = () => finish({ decision: "cancel", reason: "aborted" });

        target.addEventListener(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, onResponse);
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener?.("abort", onAbort, { once: true });
        // React installs the overlay asynchronously.  Calls made during the
        // legacy runtime bootstrap are retained until that one listener is
        // ready instead of silently losing a required confirmation.
        if (target === globalThis.window && target[MASTER_TIME_RANGE_DIALOG_READY_KEY] !== true) {
            const pending = Array.isArray(target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY])
                ? target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY]
                : [];
            pending.push(detail);
            target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY] = pending;
            return;
        }
        target.dispatchEvent(createEvent(target, MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, detail));
    });
}

/**
 * Presentation facts used by both React object cards and legacy tree rows.
 */
export function masterTimeRangeObjectStatus(status) {
    const normalized = text(typeof status === "object" ? status?.status : status)
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    const outOfRange = normalized === MASTER_TIME_RANGE_OUT_OF_RANGE_STATUS;
    return {
        status: outOfRange ? MASTER_TIME_RANGE_OUT_OF_RANGE_STATUS : normalized || "active",
        outOfRange,
        active: !outOfRange,
        label: outOfRange ? "Inactivo (fuera de rango)" : "Activo",
        message: outOfRange ? MASTER_TIME_RANGE_OUT_OF_RANGE_MESSAGE : ""
    };
}

function firstStatusValue(sources) {
    const keys = [
        "temporal_status", "temporalStatus",
        "master_time_range_status", "masterTimeRangeStatus",
        "mtr_status", "mtrStatus",
        "runtime_state", "runtimeState",
        "status"
    ];
    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of keys) {
            const candidate = source[key];
            if (typeof candidate === "string" && candidate.trim()) return candidate;
        }
    }
    return "";
}

/**
 * Read the temporal state from either a telemetry payload or the React detail
 * envelope that contains it. Explicit `temporal_status` wins over generic
 * runtime wording, so a source cannot accidentally re-enable an object that
 * the MTR has marked outside its intrinsic coverage.
 */
export function resolveMasterTimeRangeObjectStatus(object) {
    if (!object || typeof object !== "object") return masterTimeRangeObjectStatus(object);
    const telemetry = object.telemetry && typeof object.telemetry === "object" ? object.telemetry : null;
    const explicitStatus = firstStatusValue([
        {
            temporal_status: object.temporal_status,
            temporalStatus: object.temporalStatus,
            master_time_range_status: object.master_time_range_status,
            masterTimeRangeStatus: object.masterTimeRangeStatus,
            mtr_status: object.mtr_status,
            mtrStatus: object.mtrStatus
        },
        telemetry && {
            temporal_status: telemetry.temporal_status,
            temporalStatus: telemetry.temporalStatus,
            master_time_range_status: telemetry.master_time_range_status,
            masterTimeRangeStatus: telemetry.masterTimeRangeStatus,
            mtr_status: telemetry.mtr_status,
            mtrStatus: telemetry.mtrStatus
        }
    ]);
    if (explicitStatus) return masterTimeRangeObjectStatus(explicitStatus);
    return masterTimeRangeObjectStatus(firstStatusValue([object, telemetry]));
}

export function formatMasterTimeRangeUtc(range) {
    const normalized = normaliseRange(range);
    if (!normalized) return "";
    const formatter = new Intl.DateTimeFormat("es-ES", {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "medium"
    });
    return `${formatter.format(new Date(normalized.startMs))} UTC — ${formatter.format(new Date(normalized.endMs))} UTC`;
}

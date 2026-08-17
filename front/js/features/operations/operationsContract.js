/**
 * Global, transport-neutral activity ledger.
 *
 * Long-running work in Orbit can originate in the legacy scene runtime, a
 * React panel, or a future worker.  This small contract gives all of them one
 * observable lifecycle without coupling them to a particular UI.  A producer
 * may either import the helpers below or dispatch the documented DOM events.
 *
 * Operations are deliberately live-only: a completed, failed or cancelled
 * item is removed from the ledger.  The activity glyph therefore only spins
 * while useful work is actually in progress, instead of becoming a second
 * notification/history system.
 */

export const ORBIT_OPERATION_START_EVENT = "orbit:operation-start";
export const ORBIT_OPERATION_UPDATE_EVENT = "orbit:operation-update";
export const ORBIT_OPERATION_COMPLETE_EVENT = "orbit:operation-complete";
export const ORBIT_OPERATION_FAIL_EVENT = "orbit:operation-fail";
export const ORBIT_OPERATION_CANCEL_EVENT = "orbit:operation-cancel";
export const ORBIT_OPERATION_CANCEL_REQUEST_EVENT = "orbit:operation-cancel-request";
export const ORBIT_OPERATIONS_CLEAR_SCOPE_EVENT = "orbit:operations-clear-scope";
export const ORBIT_OPERATIONS_STATE_EVENT = "orbit:operations-state";
export const ORBIT_OPERATIONS_STATE_REQUEST_EVENT = "orbit:operations-state-request";

export const OPERATION_SCOPES = Object.freeze({
    SYSTEM: "system",
    SCENE: "scene",
    PROJECT: "project",
    MANUAL_ORBIT: "manual-orbit",
    // Kept as a descriptive compatibility alias for early producers.  Scope
    // remains an open string so new panels can identify their own ownership.
    ORBIT_DESIGN: "orbit-design"
});

export const OPERATION_STATUSES = Object.freeze({
    QUEUED: "queued",
    RUNNING: "running"
});

const ACTIVE_STATUSES = new Set(Object.values(OPERATION_STATUSES));
const operationStore = new Map();
const subscribers = new Set();
const installedTargets = new WeakSet();
let generatedId = 0;

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function epochNow() {
    return new Date().toISOString();
}

function normalizedProgress(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.min(100, number));
}

function normalizedStatus(value, fallback = OPERATION_STATUSES.RUNNING) {
    const candidate = text(value).toLowerCase();
    return ACTIVE_STATUSES.has(candidate) ? candidate : fallback;
}

function generatedOperationId() {
    generatedId += 1;
    return `operation-${Date.now()}-${generatedId}`;
}

function cloneOperation(operation) {
    return Object.freeze({ ...operation });
}

function snapshot() {
    return Object.freeze([...operationStore.values()]
        .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))
        .map(cloneOperation));
}

function notify(target = globalThis.window) {
    const value = snapshot();
    subscribers.forEach((subscriber) => subscriber(value));
    // Keep a read-only snapshot for late-mounted legacy consumers.  The
    // event remains the primary contract; this mirrors Orbit's other runtime
    // bridges and avoids a UI mount race during application startup.
    if (target && typeof target === "object") target.__orbitActiveOperations = value;
    if (!target || typeof target.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return value;
    target.dispatchEvent(new CustomEvent(ORBIT_OPERATIONS_STATE_EVENT, { detail: value }));
    return value;
}

function operationId(detail) {
    return text(record(detail).id);
}

function applyStart(detail, target) {
    const source = record(detail);
    const id = operationId(source) || generatedOperationId();
    const previous = operationStore.get(id);
    const now = epochNow();
    const next = {
        id,
        title: text(source.title) || previous?.title || "Operación en curso",
        scope: text(source.scope) || previous?.scope || OPERATION_SCOPES.SCENE,
        status: normalizedStatus(source.status),
        stage: text(source.stage) || "",
        progress: normalizedProgress(source.progress),
        message: text(source.message) || "",
        cancellable: source.cancellable === true,
        startedAt: previous?.startedAt || now,
        updatedAt: now
    };
    operationStore.set(id, next);
    return notify(target);
}

function applyUpdate(detail, target) {
    const source = record(detail);
    const id = operationId(source);
    const previous = id ? operationStore.get(id) : null;
    // Updates never invent a running task.  Producers must explicitly start
    // it, which prevents a late async callback from reviving an aborted UI.
    if (!previous) return snapshot();
    const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
    operationStore.set(id, {
        ...previous,
        title: has("title") ? text(source.title) || previous.title : previous.title,
        scope: has("scope") ? text(source.scope) || previous.scope : previous.scope,
        status: has("status") ? normalizedStatus(source.status, previous.status) : previous.status,
        stage: has("stage") ? text(source.stage) : previous.stage,
        progress: has("progress") ? normalizedProgress(source.progress) : previous.progress,
        message: has("message") ? text(source.message) : previous.message,
        cancellable: has("cancellable") ? source.cancellable === true : previous.cancellable,
        updatedAt: epochNow()
    });
    return notify(target);
}

function applyEnd(detail, target) {
    const id = operationId(detail);
    if (!id || !operationStore.has(id)) return snapshot();
    operationStore.delete(id);
    return notify(target);
}

function applyClearScope(detail, target) {
    const scope = text(record(detail).scope);
    if (!scope) return snapshot();
    let changed = false;
    operationStore.forEach((operation, id) => {
        if (operation.scope !== scope) return;
        operationStore.delete(id);
        changed = true;
    });
    return changed ? notify(target) : snapshot();
}

function applyEvent(type, detail, target) {
    if (type === ORBIT_OPERATION_START_EVENT) return applyStart(detail, target);
    if (type === ORBIT_OPERATION_UPDATE_EVENT) return applyUpdate(detail, target);
    if ([ORBIT_OPERATION_COMPLETE_EVENT, ORBIT_OPERATION_FAIL_EVENT, ORBIT_OPERATION_CANCEL_EVENT].includes(type)) return applyEnd(detail, target);
    if (type === ORBIT_OPERATIONS_CLEAR_SCOPE_EVENT) return applyClearScope(detail, target);
    return snapshot();
}

function dispatch(type, detail, target = globalThis.window) {
    const windowRef = target && typeof target.dispatchEvent === "function" ? target : null;
    const payload = { ...record(detail), __orbitOperationApplied: true };
    const value = applyEvent(type, payload, windowRef);
    if (!windowRef || typeof CustomEvent === "undefined") return value;
    windowRef.dispatchEvent(new CustomEvent(type, { detail: payload }));
    return value;
}

/**
 * Binds DOM events emitted by legacy code to the shared ledger.  It is safe
 * to call multiple times and supports an injected EventTarget in unit tests.
 */
export function bindOperationEvents(target = globalThis.window) {
    if (!target || typeof target.addEventListener !== "function" || installedTargets.has(target)) return () => {};
    installedTargets.add(target);
    const handlers = [
        ORBIT_OPERATION_START_EVENT,
        ORBIT_OPERATION_UPDATE_EVENT,
        ORBIT_OPERATION_COMPLETE_EVENT,
        ORBIT_OPERATION_FAIL_EVENT,
        ORBIT_OPERATION_CANCEL_EVENT,
        ORBIT_OPERATIONS_CLEAR_SCOPE_EVENT,
        ORBIT_OPERATIONS_STATE_REQUEST_EVENT
    ].map((type) => [type, (event) => {
        if (type === ORBIT_OPERATIONS_STATE_REQUEST_EVENT) {
            notify(target);
            return;
        }
        if (record(event?.detail).__orbitOperationApplied === true) return;
        applyEvent(type, event?.detail, target);
    }]);
    handlers.forEach(([type, handler]) => target.addEventListener(type, handler));
    return () => {
        handlers.forEach(([type, handler]) => target.removeEventListener(type, handler));
        installedTargets.delete(target);
    };
}

export function startOperation(detail = {}, target = globalThis.window) {
    return dispatch(ORBIT_OPERATION_START_EVENT, detail, target);
}

export function updateOperation(detail = {}, target = globalThis.window) {
    return dispatch(ORBIT_OPERATION_UPDATE_EVENT, detail, target);
}

export function completeOperation(detail = {}, target = globalThis.window) {
    return dispatch(ORBIT_OPERATION_COMPLETE_EVENT, detail, target);
}

export function failOperation(detail = {}, target = globalThis.window) {
    return dispatch(ORBIT_OPERATION_FAIL_EVENT, detail, target);
}

export function cancelOperation(detail = {}, target = globalThis.window) {
    return dispatch(ORBIT_OPERATION_CANCEL_EVENT, detail, target);
}

export function clearOperationsForScope(scope, target = globalThis.window) {
    return dispatch(ORBIT_OPERATIONS_CLEAR_SCOPE_EVENT, { scope }, target);
}

/** The UI requests cancellation; the owning producer remains responsible for
 * aborting its work and subsequently emitting `orbit:operation-cancel`. */
export function requestOperationCancel(detail = {}, target = globalThis.window) {
    if (!target || typeof target.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return false;
    target.dispatchEvent(new CustomEvent(ORBIT_OPERATION_CANCEL_REQUEST_EVENT, { detail: record(detail) }));
    return true;
}

export function getActiveOperations() {
    return snapshot();
}

export function subscribeToOperations(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    listener(snapshot());
    return () => subscribers.delete(listener);
}

// Unit-test-only reset.  It is intentionally named loudly so runtime callers
// do not mistake the live ledger for a history store.
export function __resetOperationStoreForTests() {
    operationStore.clear();
    generatedId = 0;
    subscribers.clear();
}

if (typeof window !== "undefined") bindOperationEvents(window);

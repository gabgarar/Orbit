export const OBJECT_STATE_CHANGED_EVENT = "orbit:object-state-changed";

// Keep the runtime-to-UI boundary explicit: rendering code announces a state
// mutation, while the sidebar decides whether that mutation affects its active
// detail card.  The guard also makes the runtime helpers safe to import in the
// Node-only unit-test environment.
export function emitObjectStateChanged(detail = {}) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
        return;
    }

    const EventConstructor = typeof CustomEvent === "function" ? CustomEvent : window.CustomEvent;
    if (typeof EventConstructor !== "function") {
        return;
    }

    window.dispatchEvent(new EventConstructor(OBJECT_STATE_CHANGED_EVENT, { detail }));
}

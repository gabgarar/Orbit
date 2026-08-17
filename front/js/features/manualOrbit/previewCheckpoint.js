/**
 * Keep the last manual-orbit configuration that actually reached the design
 * preview.  The editor is intentionally optimistic while a new propagation
 * is running, but cancelling that propagation must not leave its controls
 * describing a trajectory that was never calculated.
 *
 * This stores only the compact editor and TIME/display settings.  The Cesium
 * preview itself already retains the last rendered geometry until a newer
 * response replaces it, so retaining an ephemeris payload here would merely
 * duplicate a potentially large sample series in memory.
 */

function cloneValue(value) {
    if (value === undefined) return undefined;
    if (typeof globalThis.structuredClone === "function") {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function snapshotFrom(value = {}) {
    return {
        editorState: cloneValue(value.editorState || null),
        definitionSource: String(value.definitionSource || "keplerian"),
        designSettings: cloneValue(value.designSettings || null),
        // The initial session checkpoint is deliberately useful too: it
        // lets a cancellation undo optimistic edits made before the very
        // first propagation completes.  In that one case the runtime knows
        // it must request a clean baseline preview after restoring.
        previewRendered: value.previewRendered === true
    };
}

/**
 * A small, framework-independent checkpoint used by the legacy runtime and
 * covered independently from Cesium/network code.
 */
export function createManualOrbitPreviewCheckpoint() {
    let applied = null;

    return {
        capture(value) {
            applied = snapshotFrom(value);
            return cloneValue(applied);
        },
        read() {
            return applied ? cloneValue(applied) : null;
        },
        clear() {
            applied = null;
        }
    };
}

import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveLayerActionsState,
    emitLayerActionsState,
    getLayerActionsState,
    LAYER_ACTIONS_STATE_EVENT
} from "../../js/runtime/layerActionsState.js";

test("layer actions are unavailable until a layer is active", () => {
    assert.deepEqual(deriveLayerActionsState([]), {
        activeLayerCount: 0,
        hasActiveLayers: false
    });
    assert.deepEqual(deriveLayerActionsState(["SAT-1", "GS-1"]), {
        activeLayerCount: 2,
        hasActiveLayers: true
    });
    assert.deepEqual(deriveLayerActionsState(["", "  ", null, undefined, "SAT-1", "SAT-1"]), {
        activeLayerCount: 1,
        hasActiveLayers: true
    });
});

test("the permanent Earth body does not enable global remove or visibility actions", () => {
    assert.deepEqual(deriveLayerActionsState(["body:earth"]), {
        activeLayerCount: 0,
        hasActiveLayers: false
    });
    assert.deepEqual(deriveLayerActionsState(["body:earth", "SAT-1"]), {
        activeLayerCount: 1,
        hasActiveLayers: true
    });
});

test("layer action availability is published for the React shell", () => {
    const originalWindow = globalThis.window;
    const originalCustomEvent = globalThis.CustomEvent;
    const events = [];

    class TestCustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    }

    globalThis.CustomEvent = TestCustomEvent;
    globalThis.window = { dispatchEvent: (event) => events.push(event) };

    try {
        emitLayerActionsState(["SAT-1"]);
        assert.equal(events.length, 1);
        assert.equal(events[0].type, LAYER_ACTIONS_STATE_EVENT);
        assert.deepEqual(events[0].detail, {
            activeLayerCount: 1,
            hasActiveLayers: true
        });
        assert.deepEqual(getLayerActionsState(), events[0].detail);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = originalCustomEvent;
    }
});

test("layer action availability is safe to import without a browser", () => {
    const originalWindow = globalThis.window;
    try {
        delete globalThis.window;
        assert.doesNotThrow(() => emitLayerActionsState([]));
    } finally {
        if (originalWindow !== undefined) globalThis.window = originalWindow;
    }
});

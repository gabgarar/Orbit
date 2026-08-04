import assert from "node:assert/strict";
import test from "node:test";

import {
    OBJECT_STATE_CHANGED_EVENT,
    emitObjectStateChanged
} from "../../js/runtime/objectDetailsEvents.js";

test("object state changes are published as a typed browser event", () => {
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
    globalThis.window = {
        dispatchEvent(event) {
            events.push(event);
        }
    };

    try {
        emitObjectStateChanged({ sourceId: "SAT-1", reason: "visibility" });
        assert.equal(events.length, 1);
        assert.equal(events[0].type, OBJECT_STATE_CHANGED_EVENT);
        assert.deepEqual(events[0].detail, { sourceId: "SAT-1", reason: "visibility" });
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = originalCustomEvent;
    }
});

test("object state changes are harmless without a browser window", () => {
    const originalWindow = globalThis.window;
    try {
        delete globalThis.window;
        assert.doesNotThrow(() => emitObjectStateChanged({ sourceId: "SAT-1" }));
    } finally {
        if (originalWindow !== undefined) globalThis.window = originalWindow;
    }
});

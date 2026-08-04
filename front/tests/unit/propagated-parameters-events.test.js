import assert from "node:assert/strict";
import test from "node:test";

import {
    emitPropagatedParametersClose,
    emitPropagatedParametersContext,
    emitPropagatedParametersOpen,
    PROPAGATED_PARAMETERS_CLOSE_EVENT,
    PROPAGATED_PARAMETERS_CONTEXT_EVENT,
    PROPAGATED_PARAMETERS_OPEN_EVENT
} from "../../js/runtime/propagatedParametersEvents.js";

test("propagated-parameter entry events retain the source and target context", () => {
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
        emitPropagatedParametersOpen({ id: "SAT-1", source: "layer" });
        emitPropagatedParametersContext({ id: "SAT-1", source: "layer", startTime: "2026-07-21T00:00:00.000Z" });
        emitPropagatedParametersClose({ source: "sidebar" });

        assert.deepEqual(events.map((event) => event.type), [
            PROPAGATED_PARAMETERS_OPEN_EVENT,
            PROPAGATED_PARAMETERS_CONTEXT_EVENT,
            PROPAGATED_PARAMETERS_CLOSE_EVENT
        ]);
        assert.deepEqual(events[0].detail, { id: "SAT-1", source: "layer" });
        assert.equal(events[1].detail.startTime, "2026-07-21T00:00:00.000Z");
        assert.deepEqual(events[2].detail, { source: "sidebar" });
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = originalCustomEvent;
    }
});

test("propagated-parameter entry events are safe outside a browser", () => {
    const originalWindow = globalThis.window;
    try {
        delete globalThis.window;
        assert.doesNotThrow(() => emitPropagatedParametersOpen({ id: "SAT-1" }));
        assert.doesNotThrow(() => emitPropagatedParametersClose());
        assert.doesNotThrow(() => emitPropagatedParametersContext({ id: "SAT-1" }));
    } finally {
        if (originalWindow !== undefined) globalThis.window = originalWindow;
    }
});

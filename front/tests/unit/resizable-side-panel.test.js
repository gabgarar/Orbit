import assert from "node:assert/strict";
import test from "node:test";

import { setupResizableSidePanel } from "../../js/ui/resizableSidePanel.js";

function createClassList(initial = []) {
    const values = new Set(initial);
    return {
        add: (value) => values.add(value),
        remove: (value) => values.delete(value),
        contains: (value) => values.has(value)
    };
}

function createPointerEvent(type, clientX) {
    const event = new Event(type);
    Object.defineProperties(event, {
        clientX: { value: clientX },
        pointerId: { value: 1 }
    });
    return event;
}

function createPanelFixture() {
    const handle = new EventTarget();
    handle.setPointerCapture = () => {};
    const values = new Map();
    const panel = {
        classList: createClassList(["open"]),
        querySelector: (selector) => selector === ".sidebar-panel-resize-handle" ? handle : null,
        getBoundingClientRect: () => ({ width: 300 }),
        style: {
            setProperty: (name, value) => values.set(name, value),
            removeProperty: (name) => values.delete(name),
            getPropertyValue: (name) => values.get(name) || ""
        }
    };
    return { handle, panel };
}

test("resizable side panel persists widths and reports a collapsed React panel", () => {
    const previousWindow = globalThis.window;
    const previousStorage = globalThis.localStorage;
    const windowRef = new EventTarget();
    windowRef.innerWidth = 1200;
    const stored = new Map();
    globalThis.window = windowRef;
    globalThis.localStorage = {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key)
    };

    try {
        const { handle, panel } = createPanelFixture();
        const triggerButton = { classList: createClassList(["active"]) };
        let collapsed = 0;
        const dispose = setupResizableSidePanel({
            panel,
            triggerButton,
            storageKey: "orbit.layersPanel.width",
            cssVariable: "--orbit-layers-panel-width",
            onCollapse: () => { collapsed += 1; }
        });

        handle.dispatchEvent(createPointerEvent("pointerdown", 100));
        windowRef.dispatchEvent(createPointerEvent("pointermove", 220));
        windowRef.dispatchEvent(new Event("pointerup"));
        assert.equal(panel.style.getPropertyValue("--orbit-layers-panel-width"), "420px");
        assert.equal(stored.get("orbit.layersPanel.width"), "420");

        handle.dispatchEvent(createPointerEvent("pointerdown", 200));
        windowRef.dispatchEvent(createPointerEvent("pointermove", 0));
        assert.equal(collapsed, 1);
        assert.equal(panel.classList.contains("open"), false);
        assert.equal(triggerButton.classList.contains("active"), false);
        assert.equal(panel.style.getPropertyValue("--orbit-layers-panel-width"), "");
        assert.equal(stored.has("orbit.layersPanel.width"), false);
        dispose();
    } finally {
        globalThis.window = previousWindow;
        globalThis.localStorage = previousStorage;
    }
});

test("resizable side panel remains usable when persistent storage is blocked", () => {
    const previousWindow = globalThis.window;
    const previousStorage = globalThis.localStorage;
    const windowRef = new EventTarget();
    windowRef.innerWidth = 1200;
    globalThis.window = windowRef;
    globalThis.localStorage = {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
        removeItem: () => { throw new Error("blocked"); }
    };

    try {
        const { handle, panel } = createPanelFixture();
        const dispose = setupResizableSidePanel({
            panel,
            triggerButton: { classList: createClassList(["active"]) },
            storageKey: "orbit.layersPanel.width",
            cssVariable: "--orbit-layers-panel-width"
        });
        handle.dispatchEvent(createPointerEvent("pointerdown", 100));
        windowRef.dispatchEvent(createPointerEvent("pointermove", 220));
        assert.equal(panel.style.getPropertyValue("--orbit-layers-panel-width"), "420px");
        dispose();
    } finally {
        globalThis.window = previousWindow;
        globalThis.localStorage = previousStorage;
    }
});

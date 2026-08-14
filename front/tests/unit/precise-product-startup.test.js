import assert from "node:assert/strict";
import test from "node:test";

import { hydratePreciseProductSatelliteEntries } from "../../js/satellites.js";
import { bindProjectLifecycleEvents } from "../../js/runtime/projectEventBridge.js";
import { startNonBlockingStartupTask } from "../../js/runtime/nonBlockingStartupTask.js";
import {
    getOrbitRuntimeStatus,
    requestProjectCommand
} from "../../../react-ui/src/services/projectRuntime.js";

test("a pending precise-product hydration cannot delay New project", async () => {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    const windowRef = new EventTarget();
    windowRef.CustomEvent = globalThis.CustomEvent;
    // Precise-product metadata is optional. The required startup gate has
    // already completed, so this deliberately slow hydration must not delay
    // an otherwise valid New-project action.
    windowRef.__orbitStartupStatus = { ready: true };
    const created = [];
    let resolveFetch;

    try {
        globalThis.window = windowRef;
        globalThis.fetch = () => new Promise((resolve) => {
            resolveFetch = resolve;
        });

        bindProjectLifecycleEvents({
            windowRef,
            projectLifecycle: {
                startNew: (name) => created.push(name),
                exportProject: () => {},
                saveToHandle: async () => {},
                loadFile: async () => {}
            },
            requestDialog: () => {},
            getProjectFileHandle: () => null,
            setProjectFileHandle: () => {},
            isProjectFile: () => false,
            showAlert: () => {},
            getAlertTitle: () => "Orbit",
            logger: { error: () => {} }
        });

        const hydration = startNonBlockingStartupTask(
            () => hydratePreciseProductSatelliteEntries()
        );
        await Promise.resolve();

        assert.equal(typeof resolveFetch, "function", "the optional SP3 request has started");
        assert.equal(getOrbitRuntimeStatus(windowRef).state, "ready");
        assert.deepEqual(
            requestProjectCommand({ type: "new", name: "Immediate workspace" }, windowRef),
            { accepted: true, queued: false }
        );
        assert.deepEqual(created, ["Immediate workspace"]);

        // Finish the otherwise-pending optional request without registering
        // product data. The project command must already have completed.
        resolveFetch({ ok: false });
        assert.deepEqual(await hydration, []);
    } finally {
        globalThis.window = previousWindow;
        globalThis.fetch = previousFetch;
    }
});

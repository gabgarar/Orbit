import assert from "node:assert/strict";
import test from "node:test";

import { createManualOrbitPreviewCheckpoint } from "../../js/features/manualOrbit/previewCheckpoint.js";

test("a manual preview checkpoint keeps the last rendered multi-force draft isolated from later optimistic edits", () => {
    const checkpoint = createManualOrbitPreviewCheckpoint();
    const lastRendered = {
        editorState: {
            propagator: "cowell-rk4",
            propagationOptions: {
                forceTerms: ["central", "geopotential", "relativity"],
                geopotentialModel: "EGM2008",
                geopotentialDegree: 50,
                geopotentialOrder: 50
            }
        },
        definitionSource: "state-vector",
        designSettings: {
            groundTrackPreview: true,
            previewReferenceFrame: "eme2000",
            epochStartUtc: "2026-08-17T10:00:00.000Z",
            epochEndUtc: "2026-08-17T12:00:00.000Z"
        },
        previewRendered: true
    };

    checkpoint.capture(lastRendered);

    // Simulate the controlled form accepting a new, costly draft while its
    // propagation is still running.  A later cancellation must not retain
    // these values simply because the caller still owns this object.
    lastRendered.editorState.propagationOptions.forceTerms.push("third-body-sun");
    lastRendered.editorState.propagationOptions.geopotentialDegree = 2190;
    lastRendered.designSettings.previewReferenceFrame = "itrf";

    const restored = checkpoint.read();
    assert.deepEqual(restored, {
        editorState: {
            propagator: "cowell-rk4",
            propagationOptions: {
                forceTerms: ["central", "geopotential", "relativity"],
                geopotentialModel: "EGM2008",
                geopotentialDegree: 50,
                geopotentialOrder: 50
            }
        },
        definitionSource: "state-vector",
        designSettings: {
            groundTrackPreview: true,
            previewReferenceFrame: "eme2000",
            epochStartUtc: "2026-08-17T10:00:00.000Z",
            epochEndUtc: "2026-08-17T12:00:00.000Z"
        },
        previewRendered: true
    });

    // `read()` is also isolated: a UI merge must not mutate the checkpoint
    // that protects a subsequent cancel/retry cycle.
    restored.editorState.propagationOptions.forceTerms.push("solar-radiation-pressure");
    assert.deepEqual(
        checkpoint.read().editorState.propagationOptions.forceTerms,
        ["central", "geopotential", "relativity"]
    );
});

test("the first preview checkpoint is restorable even before Cesium has drawn it", () => {
    const checkpoint = createManualOrbitPreviewCheckpoint();

    checkpoint.capture({
        editorState: { propagator: "cowell-rk4", propagationOptions: { forceTerms: ["central"] } },
        designSettings: { previewReferenceFrame: "eme2000" }
    });

    assert.deepEqual(checkpoint.read(), {
        editorState: { propagator: "cowell-rk4", propagationOptions: { forceTerms: ["central"] } },
        definitionSource: "keplerian",
        designSettings: { previewReferenceFrame: "eme2000" },
        previewRendered: false
    });

    checkpoint.clear();
    assert.equal(checkpoint.read(), null);
});

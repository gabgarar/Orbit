import assert from "node:assert/strict";
import test from "node:test";

import {
    clampTimelineStep,
    timelineStepFromPointer,
    timelineStepFromWheel
} from "../../js/runtime/simulation/timelineNavigation.js";

test("timeline pointer navigation maps the whole visual rail and clamps its edges", () => {
    const track = { left: 100, width: 800, steps: 10_000 };

    assert.equal(timelineStepFromPointer({ ...track, clientX: 100 }), 0);
    assert.equal(timelineStepFromPointer({ ...track, clientX: 500 }), 5_000);
    assert.equal(timelineStepFromPointer({ ...track, clientX: 900 }), 10_000);
    assert.equal(timelineStepFromPointer({ ...track, clientX: 2_000 }), 10_000);
    assert.equal(timelineStepFromPointer({ ...track, clientX: 50 }), 0);
});

test("timeline pointer navigation rejects an unusable track rectangle", () => {
    assert.equal(timelineStepFromPointer({ clientX: 10, left: 0, width: 0, steps: 100 }), null);
    assert.equal(timelineStepFromPointer({ clientX: Number.NaN, left: 0, width: 100, steps: 100 }), null);
});

test("timeline wheel navigation moves by a bounded relative increment in either direction", () => {
    assert.equal(timelineStepFromWheel({ currentStep: 5000, steps: 10_000, deltaY: 100 }), 5010);
    assert.equal(timelineStepFromWheel({ currentStep: 5000, steps: 10_000, deltaY: -100 }), 4990);
    assert.equal(timelineStepFromWheel({ currentStep: 9998, steps: 10_000, deltaX: 120 }), 10_000);
    assert.equal(timelineStepFromWheel({ currentStep: 2, steps: 10_000, deltaY: -120 }), 0);
    assert.equal(timelineStepFromWheel({ currentStep: 5000, steps: 10_000, deltaX: 1, deltaY: 100 }), 5010);
});

test("timeline step normalization remains safe for malformed UI state", () => {
    assert.equal(clampTimelineStep(-4, 100), 0);
    assert.equal(clampTimelineStep(104, 100), 100);
    assert.equal(clampTimelineStep(14.6, 100), 15);
    assert.equal(timelineStepFromWheel({ currentStep: 2_000, steps: 0, deltaY: 0 }), 1_000);
});

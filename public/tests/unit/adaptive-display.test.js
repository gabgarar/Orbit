import assert from "node:assert/strict";
import test from "node:test";

import { getAdaptiveResolutionScale, getAdaptiveUiScale } from "../../js/runtime/adaptiveDisplay.js";

test("adaptive UI scale remains inside supported bounds", () => {
    assert.equal(getAdaptiveUiScale({ innerWidth: 1920, innerHeight: 1080 }), 0.84);
    assert.ok(getAdaptiveUiScale({ innerWidth: 390, innerHeight: 844 }) <= 0.84);
    assert.ok(getAdaptiveUiScale({ innerWidth: 320, innerHeight: 480 }) >= 0.68);
});

test("adaptive resolution scale favours constrained displays", () => {
    const desktop = getAdaptiveResolutionScale({ innerWidth: 1920, innerHeight: 1080 });
    const mobile = getAdaptiveResolutionScale({ innerWidth: 390, innerHeight: 844 });
    assert.ok(desktop >= mobile);
    assert.ok(mobile > 0);
});

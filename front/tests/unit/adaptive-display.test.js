import assert from "node:assert/strict";
import test from "node:test";

import { getAdaptiveResolutionScale, getAdaptiveUiScale } from "../../js/runtime/adaptiveDisplay.js";
import { createAdaptiveDisplayController } from "../../js/runtime/adaptiveDisplayController.js";

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

test("antialiasing keeps thin orbital lines at full render resolution", () => {
    const viewer = {
        useBrowserRecommendedResolution: true,
        resolutionScale: 0,
        resizeCalls: 0,
        resize() { this.resizeCalls += 1; }
    };
    const controller = createAdaptiveDisplayController({
        viewer,
        windowRef: {},
        documentRef: { documentElement: { style: { setProperty() {} } } },
        getResolutionScale: () => 0.84,
        getUiScale: () => 0.84,
        logger: { info() {} }
    });

    controller.applyResolution({ antialias_mode: "msaa" }, { silent: true });
    assert.equal(viewer.resolutionScale, 1);
    assert.equal(viewer.useBrowserRecommendedResolution, false);
    assert.equal(viewer.resizeCalls, 1);

    controller.applyResolution({ antialias_mode: "off" }, { silent: true });
    assert.equal(viewer.resolutionScale, 0.84);
});

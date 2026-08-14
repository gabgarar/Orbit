import assert from "node:assert/strict";
import test from "node:test";

import {
    designWindowFromManualErp,
    intersectManualOrbitUtcRanges,
    manualOrbitForceTermsRequireErp,
    normalizeManualOrbitUtcRange,
    physicalEpochAtDesignWindowStart,
    resolveManualOrbitTimePolicy,
    utcRangeCovers
} from "../../js/features/manualOrbit/timePolicy.js";

const ERP = {
    startTime: "2026-08-01T00:00:00Z",
    endTime: "2026-08-03T00:00:00Z"
};

test("TIME uses the complete manual ERP coverage as its automatic UTC design window", () => {
    const window = designWindowFromManualErp(ERP);

    assert.deepEqual(window, {
        startMs: Date.parse("2026-08-01T00:00:00Z"),
        endMs: Date.parse("2026-08-03T00:00:00Z"),
        startTime: "2026-08-01T00:00:00.000Z",
        endTime: "2026-08-03T00:00:00.000Z"
    });
    assert.equal(designWindowFromManualErp({ startTime: ERP.endTime, endTime: ERP.startTime }), null);
});

test("a validated ERP design window anchors the physical state epoch at its UTC start", () => {
    assert.equal(
        physicalEpochAtDesignWindowStart(ERP),
        "2026-08-01T00:00:00.000Z"
    );
    assert.equal(
        physicalEpochAtDesignWindowStart({ startTime: ERP.endTime, endTime: ERP.startTime }),
        null
    );
});

test("datetime-local TIME values are interpreted as UTC, not browser-local time", () => {
    const range = normalizeManualOrbitUtcRange({
        startTime: "2026-08-01T12:34",
        endTime: "2026-08-01T12:35"
    });

    assert.equal(range.startTime, "2026-08-01T12:34:00.000Z");
    assert.equal(range.endTime, "2026-08-01T12:35:00.000Z");
});

test("finite-product epoch-millisecond aliases remain UTC ranges", () => {
    const startMs = Date.parse("2026-08-01T12:34:00Z");
    const range = normalizeManualOrbitUtcRange({
        start_time_ms: String(startMs),
        endTimeMs: startMs + 60_000
    });

    assert.equal(range.startTime, "2026-08-01T12:34:00.000Z");
    assert.equal(range.endTime, "2026-08-01T12:35:00.000Z");
});

test("only Earth-fixed manual force terms use Earth orientation", () => {
    assert.equal(manualOrbitForceTermsRequireErp(["central", "geopotential"]), true);
    assert.equal(manualOrbitForceTermsRequireErp("central, drag"), true);
    assert.equal(manualOrbitForceTermsRequireErp(["full_geopotential"]), true);
    assert.equal(manualOrbitForceTermsRequireErp(["atmospheric-drag"]), true);
    assert.equal(manualOrbitForceTermsRequireErp(["third-body-sun", "solar-radiation-pressure", "relativity"]), false);
});

test("a force requiring ERP cannot create outside its complete ERP coverage", () => {
    const designWindow = {
        startTime: "2026-07-31T23:59:59Z",
        endTime: "2026-08-01T01:00:00Z"
    };
    const policy = resolveManualOrbitTimePolicy({
        designWindow,
        erpCoverage: ERP,
        forceTerms: ["central", "geopotential"]
    });

    assert.equal(policy.canCreate, false);
    assert.equal(policy.requiresErp, true);
    assert.equal(policy.erpCoversDesign, false);
    assert.deepEqual(policy.blockingReasons, ["manual-erp-does-not-cover-design-window"]);
});

test("ERP coverage includes the physical state epoch, not only the visible design window", () => {
    const policy = resolveManualOrbitTimePolicy({
        designWindow: {
            startTime: "2026-08-01T01:00:00Z",
            endTime: "2026-08-01T02:00:00Z"
        },
        // Cowell would integrate forward from this state even though the
        // requested rendered interval itself is inside the ERP.
        physicalEpoch: "2026-07-31T23:59:59Z",
        erpCoverage: ERP,
        forceTerms: ["central", "drag"]
    });

    assert.equal(policy.canCreate, false);
    assert.equal(policy.erpCoversDesign, true);
    assert.equal(policy.erpCoversPhysicalEpoch, false);
    assert.deepEqual(policy.blockingReasons, ["manual-erp-does-not-cover-physical-epoch"]);
});

test("missing manual ERP selects automatic IERS for Earth-fixed forces", () => {
    const designWindow = {
        startTime: "2026-08-01T01:00:00Z",
        endTime: "2026-08-01T02:00:00Z"
    };

    const earthFixed = resolveManualOrbitTimePolicy({
        designWindow,
        forceTerms: ["drag"]
    });
    assert.equal(earthFixed.canCreate, true);
    assert.equal(earthFixed.requiresErp, true);
    assert.equal(earthFixed.usesAutomaticIers, true);
    assert.deepEqual(earthFixed.blockingReasons, []);

    const inertial = resolveManualOrbitTimePolicy({
        designWindow,
        forceTerms: ["central", "third-body-sun"]
    });
    assert.equal(inertial.canCreate, true);
    assert.equal(inertial.requiresErp, false);
});

test("scene and finite SP3/OEM coverage produce a common UTC joint-operation interval", () => {
    const policy = resolveManualOrbitTimePolicy({
        designWindow: {
            startTime: "2026-08-01T00:00:00Z",
            endTime: "2026-08-03T00:00:00Z"
        },
        sceneWindow: {
            startTime: "2026-08-01T12:00:00Z",
            endTime: "2026-08-02T18:00:00Z"
        },
        finiteEphemerisRanges: [
            { source: "SP3", startTime: "2026-08-01T06:00:00Z", endTime: "2026-08-02T12:00:00Z" },
            { source: "OEM", startTime: "2026-08-01T18:00:00Z", endTime: "2026-08-02T23:00:00Z" }
        ]
    });

    assert.equal(policy.canCreate, true);
    assert.equal(policy.sceneRelation, "overlap");
    assert.equal(policy.jointOperationsAllowed, true);
    assert.deepEqual(policy.jointWindow, {
        startMs: Date.parse("2026-08-01T18:00:00Z"),
        endMs: Date.parse("2026-08-02T12:00:00Z"),
        startTime: "2026-08-01T18:00:00.000Z",
        endTime: "2026-08-02T12:00:00.000Z"
    });
    assert.deepEqual(policy.warnings, ["joint-operations-must-use-common-window"]);
});

test("a disjoint finite product does not invalidate a manual orbit but blocks joint analysis", () => {
    const policy = resolveManualOrbitTimePolicy({
        designWindow: {
            startTime: "2026-08-01T00:00:00Z",
            endTime: "2026-08-02T00:00:00Z"
        },
        finiteEphemerisRanges: [
            { source: "SP3", startTime: "2026-08-04T00:00:00Z", endTime: "2026-08-05T00:00:00Z" }
        ]
    });

    assert.equal(policy.canCreate, true);
    assert.equal(policy.sceneRelation, "disjoint");
    assert.equal(policy.jointOperationsAllowed, false);
    assert.deepEqual(policy.warnings, ["no-common-window-with-active-scene"]);
});

test("disjoint OEM tracks never turn their aggregate timeline bounds into a joint window", () => {
    const policy = resolveManualOrbitTimePolicy({
        // This date belongs to the min/max aggregate of the two OEM files,
        // but to neither source product.  Joint analysis must stay blocked.
        designWindow: {
            startTime: "2026-08-02T12:00:00Z",
            endTime: "2026-08-02T13:00:00Z"
        },
        finiteEphemerisRanges: [
            { source: "OEM A", startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-02T00:00:00Z" },
            { source: "OEM B", startTime: "2026-08-03T00:00:00Z", endTime: "2026-08-04T00:00:00Z" }
        ]
    });

    assert.equal(policy.canCreate, true);
    assert.equal(policy.sceneRelation, "disjoint");
    assert.equal(policy.jointOperationsAllowed, false);
    assert.equal(policy.jointWindow, null);
});

test("range primitives only report a common interval when every endpoint is ordered", () => {
    const inner = { startTime: "2026-08-01T03:00:00Z", endTime: "2026-08-01T04:00:00Z" };
    assert.equal(utcRangeCovers(ERP, inner), true);
    assert.equal(utcRangeCovers(inner, ERP), false);
    assert.equal(intersectManualOrbitUtcRanges([
        ERP,
        { startTime: "2026-08-03T00:00:00Z", endTime: "2026-08-04T00:00:00Z" }
    ]), null);
});

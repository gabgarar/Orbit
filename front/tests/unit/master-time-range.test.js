import assert from "node:assert/strict";
import test from "node:test";

import {
    clampToMasterRange,
    clearMasterTimeRange,
    createMasterTimeRangeStore,
    expandMasterTimeRange,
    getMasterTimeRange,
    isInsideMasterRange,
    isInsideObjectRange,
    setMasterTimeRange,
    validateObjectFitsMTR,
    validateObjectRange
} from "../../js/runtime/simulation/masterTimeRange.js";
import { getDateAtTimelineRatio, getTimelineRatio } from "../../js/runtime/simulation/timeline.js";

const OEM_RANGE = Object.freeze({
    startDate: "2026-08-10T00:00:00Z",
    endDate: "2026-08-10T06:00:00Z"
});
const SP3_RANGE = Object.freeze({
    coverageStart: "2026-08-09T00:00:00Z",
    coverageEnd: "2026-08-16T23:59:45Z"
});

function millis(value) {
    return new Date(value).getTime();
}

test.afterEach(() => clearMasterTimeRange());

test("OEM loaded first establishes the exact Master Time Range", () => {
    const result = setMasterTimeRange(OEM_RANGE.startDate, OEM_RANGE.endDate);

    assert.equal(result.startDate.getTime(), millis(OEM_RANGE.startDate));
    assert.equal(result.endDate.getTime(), millis(OEM_RANGE.endDate));
    assert.equal(getMasterTimeRange().startDate.getTime(), millis(OEM_RANGE.startDate));
    assert.equal(getMasterTimeRange().endDate.getTime(), millis(OEM_RANGE.endDate));
});

test("SP3 loaded first establishes the weekly Master Time Range", () => {
    const firstObject = validateObjectFitsMTR(SP3_RANGE);
    assert.equal(firstObject.valid, true);
    assert.equal(firstObject.accepted, true);
    assert.equal(firstObject.requiresInitialization, true);

    setMasterTimeRange(firstObject.range.startDate, firstObject.range.endDate);
    const mtr = getMasterTimeRange();
    assert.equal(mtr.startDate.getTime(), millis(SP3_RANGE.coverageStart));
    assert.equal(mtr.endDate.getTime(), millis(SP3_RANGE.coverageEnd));
});

test("an imported orbit wholly inside MTR is accepted without expansion", () => {
    setMasterTimeRange(OEM_RANGE.startDate, OEM_RANGE.endDate);

    const result = validateObjectFitsMTR({
        startTime: "2026-08-10T01:00:00Z",
        endTime: "2026-08-10T02:00:00Z"
    });

    assert.equal(result.accepted, true);
    assert.equal(result.fitsMTR, true);
    assert.equal(result.requiresExpansion, false);
});

test("an imported orbit outside MTR requests expansion then is accepted", () => {
    setMasterTimeRange(OEM_RANGE.startDate, OEM_RANGE.endDate);
    const importedOrbit = {
        startTime: "2026-08-09T23:00:00Z",
        endTime: "2026-08-10T08:00:00Z"
    };

    const beforeExpansion = validateObjectFitsMTR(importedOrbit);
    assert.equal(beforeExpansion.accepted, false);
    assert.equal(beforeExpansion.requiresExpansion, true);
    assert.equal(beforeExpansion.reason, "outside-master-time-range");

    expandMasterTimeRange(beforeExpansion.range.startDate, beforeExpansion.range.endDate);
    const afterExpansion = validateObjectFitsMTR(importedOrbit);
    assert.equal(afterExpansion.accepted, true);
    assert.equal(getMasterTimeRange().startDate.getTime(), millis("2026-08-09T23:00:00Z"));
    assert.equal(getMasterTimeRange().endDate.getTime(), millis("2026-08-10T08:00:00Z"));
});

test("a generated orbit inside MTR is accepted", () => {
    setMasterTimeRange(OEM_RANGE.startDate, OEM_RANGE.endDate);

    const result = validateObjectFitsMTR([
        "2026-08-10T03:00:00Z",
        "2026-08-10T05:30:00Z"
    ]);

    assert.equal(result.valid, true);
    assert.equal(result.accepted, true);
    assert.equal(result.requiresExpansion, false);
});

test("a generated orbit outside MTR requests expansion then is accepted", () => {
    setMasterTimeRange(OEM_RANGE.startDate, OEM_RANGE.endDate);
    const requestedWindow = {
        t_min: "2026-08-10T05:00:00Z",
        t_max: "2026-08-10T08:00:00Z"
    };

    const beforeExpansion = validateObjectFitsMTR(requestedWindow);
    assert.equal(beforeExpansion.accepted, false);
    assert.equal(beforeExpansion.requiresExpansion, true);

    expandMasterTimeRange(requestedWindow.t_min, requestedWindow.t_max);
    assert.equal(validateObjectFitsMTR(requestedWindow).accepted, true);
    assert.equal(getMasterTimeRange().endDate.getTime(), millis(requestedWindow.t_max));
});

test("realtime is allowed only when now belongs to MTR", () => {
    setMasterTimeRange("2026-08-10T00:00:00Z", "2026-08-10T00:00:10Z");

    assert.equal(isInsideMasterRange("2026-08-10T00:00:05Z"), true);
    assert.equal(isInsideMasterRange("2026-08-10T00:00:11Z"), false);
    assert.equal(isInsideMasterRange("not-a-date"), false);
    assert.equal(isInsideMasterRange("2026-08-10T00:00:00Z"), true, "MTR start is inclusive");
    assert.equal(isInsideMasterRange("2026-08-10T00:00:10Z"), true, "MTR end is inclusive");
});

test("timeline times clamp to Master Time Range boundaries", () => {
    setMasterTimeRange(OEM_RANGE.startDate, OEM_RANGE.endDate);

    assert.equal(clampToMasterRange("2026-08-09T20:00:00Z").getTime(), millis(OEM_RANGE.startDate));
    assert.equal(clampToMasterRange("2026-08-10T12:00:00Z").getTime(), millis(OEM_RANGE.endDate));
    assert.equal(clampToMasterRange("2026-08-10T02:00:00Z").getTime(), millis("2026-08-10T02:00:00Z"));
    assert.equal(clampToMasterRange("not-a-date"), null);
});

test("a one-epoch MTR cannot be moved past its only instant by timeline ratio", () => {
    const epoch = "2026-08-10T00:00:00Z";
    setMasterTimeRange(epoch, epoch);

    const fromEnd = getDateAtTimelineRatio(1, epoch, epoch);
    assert.equal(fromEnd.getTime(), millis(epoch));
    assert.equal(getTimelineRatio(new Date(epoch), epoch, epoch), 0);
    assert.equal(clampToMasterRange(fromEnd).getTime(), millis(epoch));
});

test("objects disappear outside their own intrinsic range", () => {
    const object = {
        range: {
            start_time: "2026-08-10T01:00:00Z",
            stop_time: "2026-08-10T02:00:00Z"
        }
    };

    assert.equal(isInsideObjectRange(object, "2026-08-10T01:30:00Z"), true);
    assert.equal(isInsideObjectRange(object, "2026-08-10T00:59:59.999Z"), false);
    assert.equal(isInsideObjectRange(object, "2026-08-10T02:00:00.001Z"), false);
});

test("object predicates accept published intrinsic-time-range aliases", () => {
    const object = {
        intrinsic_time_range: {
            startTime: "2026-08-10T01:00:00Z",
            endTime: "2026-08-10T02:00:00Z"
        }
    };

    assert.equal(isInsideObjectRange(object, "2026-08-10T01:30:00Z"), true);
    assert.equal(isInsideObjectRange(object, "2026-08-10T02:00:00.001Z"), false);
});

test("missing or malformed intrinsic ranges never permit extrapolation", () => {
    assert.equal(isInsideObjectRange({}, "2026-08-10T01:00:00Z"), false);
    assert.equal(isInsideObjectRange({ range: { start: "bad", end: "also-bad" } }, "2026-08-10T01:00:00Z"), false);
    assert.equal(isInsideObjectRange({ coverage: OEM_RANGE }, "2026-08-10T08:00:00Z"), false);
});

test("object range validation is strict, supports aliases and accepts a single epoch", () => {
    const valid = validateObjectRange({
        start_time_ms: "1786320000000",
        endTimeMs: 1786320000000
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.range.startDate.getTime(), 1786320000000);
    assert.equal(valid.range.endDate.getTime(), 1786320000000);

    assert.deepEqual(validateObjectRange({ start: "2026-08-11T00:00:00Z", end: "2026-08-10T00:00:00Z" }), {
        valid: false,
        reason: "range-end-before-start",
        range: null
    });
    assert.equal(validateObjectRange({ start: "bad", end: "2026-08-10T00:00:00Z" }).reason, "invalid-range-date");
});

test("MTR API returns defensive range copies and never shrinks during expansion", () => {
    const first = setMasterTimeRange("2026-08-10T00:00:00Z", "2026-08-10T04:00:00Z");
    first.startDate.setUTCFullYear(1999);
    assert.equal(getMasterTimeRange().startDate.getTime(), millis("2026-08-10T00:00:00Z"));

    expandMasterTimeRange("2026-08-10T01:00:00Z", "2026-08-10T03:00:00Z");
    assert.equal(getMasterTimeRange().startDate.getTime(), millis("2026-08-10T00:00:00Z"));
    assert.equal(getMasterTimeRange().endDate.getTime(), millis("2026-08-10T04:00:00Z"));
});

test("an isolated MTR store does not mutate the application singleton", () => {
    const store = createMasterTimeRangeStore();
    store.setMasterTimeRange("2026-08-10T00:00:00Z", "2026-08-10T01:00:00Z");

    assert.equal(store.isInsideMasterRange("2026-08-10T00:30:00Z"), true);
    assert.equal(getMasterTimeRange(), null);
    assert.equal(store.clampToMasterRange("2026-08-10T02:00:00Z").getTime(), millis("2026-08-10T01:00:00Z"));
});

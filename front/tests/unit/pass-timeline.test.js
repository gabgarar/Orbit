import assert from "node:assert/strict";
import test from "node:test";

import { getPassTimelineMarker, getTimelinePosition } from "../../js/features/groundStations/passTimeline.js";

test("pass timeline marker prefers the exact maximum-elevation instant", () => {
    const pass = {
        aos: "2026-08-07T10:00:00.000Z",
        los: "2026-08-07T10:08:00.000Z",
        max_elevation_time: "2026-08-07T10:04:30.000Z"
    };

    assert.deepEqual(getPassTimelineMarker(pass), {
        time: Date.parse(pass.max_elevation_time),
        label: "máxima elevación"
    });
});

test("pass timeline marker falls back to midpoint and then AOS", () => {
    const aos = "2026-08-07T10:00:00.000Z";
    const los = "2026-08-07T10:08:00.000Z";

    assert.deepEqual(getPassTimelineMarker({ aos, los }), {
        time: (Date.parse(aos) + Date.parse(los)) / 2,
        label: "punto medio"
    });
    assert.deepEqual(getPassTimelineMarker({ aos }), {
        time: Date.parse(aos),
        label: "inicio del pase"
    });
    assert.equal(getPassTimelineMarker({ aos: "not-a-date" }), null);
});

test("timeline position accepts UTC strings, dates, and timestamps while rejecting invalid ranges", () => {
    const start = "2026-08-07T10:00:00.000Z";
    const end = "2026-08-07T10:10:00.000Z";
    const midpoint = "2026-08-07T10:05:00.000Z";

    assert.equal(getTimelinePosition(midpoint, start, end), 50);
    assert.equal(getTimelinePosition(new Date(midpoint), new Date(start), new Date(end)), 50);
    assert.equal(getTimelinePosition(Date.parse(midpoint), Date.parse(start), Date.parse(end)), 50);
    assert.equal(getTimelinePosition(midpoint, end, start), null);
    assert.equal(getTimelinePosition("not-a-date", start, end), null);
});

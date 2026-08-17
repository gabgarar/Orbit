import assert from "node:assert/strict";
import test from "node:test";

import {
    getPassTimelinePresentation,
    isVisiblePassTimelineEvent,
    legacyGroundStationPassesToTimelineEvents,
    normalizeGroundStationTimelineEvents
} from "../../js/features/groundStations/passTimelinePresentation.js";
import { GROUND_STATION_TIMELINE_EVENTS_EVENT } from "../../js/features/groundStations/passTimelineEvents.js";

const rangeStart = "2026-08-07T10:00:00.000Z";
const rangeEnd = "2026-08-07T10:10:00.000Z";

test("ground-station pass timeline publishes the stable aggregate event name", () => {
    assert.equal(GROUND_STATION_TIMELINE_EVENTS_EVENT, "orbit:ground-station-timeline-events");
});

test("timeline presentation fails closed for hidden, invalid, and unknown events", () => {
    const visibleMaximum = {
        id: "visible-max",
        eventType: "max",
        time: "2026-08-07T10:04:00.000Z",
        stationId: "station-1",
        stationName: "Madrid",
        satelliteLayerId: "sat-1",
        satelliteName: "SAT-1",
        passId: "pass-1",
        elevationDeg: 42.5
    };
    assert.equal(isVisiblePassTimelineEvent(visibleMaximum), true);
    assert.equal(isVisiblePassTimelineEvent({ ...visibleMaximum, visible: false }), false);
    assert.equal(isVisiblePassTimelineEvent({ ...visibleMaximum, stationVisible: false }), false);
    assert.equal(isVisiblePassTimelineEvent({ ...visibleMaximum, satelliteVisible: false }), false);
    assert.equal(isVisiblePassTimelineEvent({ ...visibleMaximum, eventType: "conjunction" }), false);
    assert.equal(isVisiblePassTimelineEvent({ ...visibleMaximum, time: "not-a-date" }), false);

    const normalized = normalizeGroundStationTimelineEvents({
        events: [
            { ...visibleMaximum, id: "los", eventType: "los", time: "2026-08-07T10:08:00.000Z" },
            visibleMaximum,
            { ...visibleMaximum, id: "hidden", eventType: "aos", visible: false }
        ]
    });

    assert.deepEqual(normalized.map((event) => event.id), ["visible-max", "los"]);
    assert.equal(normalized[0].satelliteId, "sat-1");
    assert.equal(normalized[0].elevationDeg, 42.5);
});

test("presentation places green maxima above and paired purple AOS/LOS below", () => {
    const events = [
        {
            id: "aos",
            eventType: "aos",
            time: rangeStart,
            stationId: "station-1",
            stationName: "Madrid",
            satelliteId: "sat-1",
            satelliteName: "SAT-1",
            passId: "pass-1"
        },
        {
            id: "max",
            eventType: "max",
            time: "2026-08-07T10:05:00.000Z",
            stationId: "station-1",
            stationName: "Madrid",
            satelliteId: "sat-1",
            satelliteName: "SAT-1",
            passId: "pass-1",
            elevationDeg: 71.2
        },
        {
            id: "los",
            eventType: "los",
            time: rangeEnd,
            stationId: "station-1",
            stationName: "Madrid",
            satelliteId: "sat-1",
            satelliteName: "SAT-1",
            passId: "pass-1"
        },
        {
            id: "outside",
            eventType: "max",
            time: "2026-08-07T10:11:00.000Z",
            stationId: "station-1",
            satelliteId: "sat-1",
            passId: "pass-2"
        }
    ];

    const presentation = getPassTimelinePresentation(events, rangeStart, rangeEnd);
    assert.deepEqual(presentation.map((event) => [event.id, event.label, event.position]), [
        ["aos", "AOS", 0],
        ["max", "máxima elevación", 50],
        ["los", "LOS", 100]
    ]);
    assert.deepEqual(presentation[1].relatedEvents.map((event) => event.id), ["aos", "max", "los"]);
});

test("legacy individual analysis retains exact AOS and LOS without inventing a maximum", () => {
    const events = legacyGroundStationPassesToTimelineEvents({
        stationId: "station-1",
        stationName: "Madrid",
        satelliteLayerId: "sat-1",
        satelliteName: "SAT-1",
        passes: [
            { aos: rangeStart, los: rangeEnd, max_elevation_deg: 44 },
            { aos: "2026-08-07T11:00:00.000Z", los: "2026-08-07T11:09:00.000Z", max_elevation_time: "2026-08-07T11:04:00.000Z", max_elevation_deg: 33 }
        ]
    });

    assert.deepEqual(events.map((event) => event.eventType), ["aos", "los", "max", "aos", "los"]);
    assert.equal(events[0].passId, events[1].passId);
    assert.equal(events[2].elevationDeg, 33);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
    buildGroundStationPassTimelineEvents,
    filterGroundStationPassTimelineEvents,
    GROUND_STATION_TIMELINE_EVENTS_EVENT
} from "../../js/features/groundStations/passTimelineEvents.js";

function buildVisiblePair(overrides = {}) {
    return {
        stationId: "station-madrid",
        stationName: "Madrid",
        satelliteLayerId: "sat-25544",
        sourceSatelliteId: "25544",
        satelliteName: "ISS",
        passes: [{
            aos: "2026-08-17T10:10:00.000Z",
            max_elevation_time: "2026-08-17T10:14:00.000Z",
            max_elevation_deg: 71.25,
            los: "2026-08-17T10:18:00.000Z"
        }],
        ...overrides
    };
}

test("pass timeline event contract has a stable public event name", () => {
    assert.equal(GROUND_STATION_TIMELINE_EVENTS_EVENT, "orbit:ground-station-timeline-events");
});

test("pass result becomes exact AOS, maximum and LOS events with one pair/pass identity", () => {
    const events = buildGroundStationPassTimelineEvents(buildVisiblePair());

    assert.deepEqual(events.map(({ id, passId, eventType, time, stationId, satelliteId, sourceSatelliteId, elevationDeg, maximumTimeSource }) => ({
        id, passId, eventType, time, stationId, satelliteId, sourceSatelliteId, elevationDeg, maximumTimeSource
    })), [
        {
            id: "station-madrid:sat-25544:0:aos",
            passId: "station-madrid:sat-25544:0",
            eventType: "aos",
            time: "2026-08-17T10:10:00.000Z",
            stationId: "station-madrid",
            satelliteId: "sat-25544",
            sourceSatelliteId: "25544",
            elevationDeg: undefined,
            maximumTimeSource: undefined
        },
        {
            id: "station-madrid:sat-25544:0:max",
            passId: "station-madrid:sat-25544:0",
            eventType: "max",
            time: "2026-08-17T10:14:00.000Z",
            stationId: "station-madrid",
            satelliteId: "sat-25544",
            sourceSatelliteId: "25544",
            elevationDeg: 71.25,
            maximumTimeSource: "maximum"
        },
        {
            id: "station-madrid:sat-25544:0:los",
            passId: "station-madrid:sat-25544:0",
            eventType: "los",
            time: "2026-08-17T10:18:00.000Z",
            stationId: "station-madrid",
            satelliteId: "sat-25544",
            sourceSatelliteId: "25544",
            elevationDeg: undefined,
            maximumTimeSource: undefined
        }
    ]);
});

test("green maximum event requires a reported maximum-elevation instant", () => {
    const events = buildGroundStationPassTimelineEvents(buildVisiblePair({
        passes: [{
            aos: "2026-08-17T10:10:00.000Z",
            los: "2026-08-17T10:18:00.000Z",
            max_elevation_deg: 48
        }, {
            aos: "2026-08-17T10:20:00.000Z",
            max_elevation_time: "not-a-time",
            los: "2026-08-17T10:28:00.000Z"
        }]
    }));

    assert.deepEqual(events.map((event) => [event.passIndex, event.eventType, event.time]), [
        [0, "aos", "2026-08-17T10:10:00.000Z"],
        [0, "los", "2026-08-17T10:18:00.000Z"],
        [1, "aos", "2026-08-17T10:20:00.000Z"],
        [1, "los", "2026-08-17T10:28:00.000Z"]
    ]);
});

test("event conversion ignores malformed records and keeps chronological deterministic order", () => {
    const events = buildGroundStationPassTimelineEvents(buildVisiblePair({
        passes: [{
            aos: "2026-08-17T10:20:00.000Z",
            max_elevation_time: "2026-08-17T10:20:00.000Z",
            los: "2026-08-17T10:20:00.000Z"
        }, {
            aos: "not-a-time",
            max_elevation_time: "2026-08-17T10:05:00.000Z",
            los: null
        }, null]
    }));

    assert.deepEqual(events.map((event) => `${event.time}:${event.eventType}:${event.passIndex}`), [
        "2026-08-17T10:05:00.000Z:max:1",
        "2026-08-17T10:20:00.000Z:max:0",
        "2026-08-17T10:20:00.000Z:aos:0",
        "2026-08-17T10:20:00.000Z:los:0"
    ]);
    assert.deepEqual(buildGroundStationPassTimelineEvents({ stationId: "station", passes: [] }), []);
});

test("visibility filtering removes all markers for a hidden station or satellite without affecting other pairs", () => {
    const madridIss = buildGroundStationPassTimelineEvents(buildVisiblePair());
    const canarySentinel = buildGroundStationPassTimelineEvents(buildVisiblePair({
        stationId: "station-canary",
        satelliteLayerId: "sat-sentinel",
        sourceSatelliteId: "sentinel",
        satelliteName: "Sentinel",
        passes: [{ aos: "2026-08-17T10:11:00.000Z", max_elevation_time: "2026-08-17T10:15:00.000Z", los: "2026-08-17T10:19:00.000Z" }]
    }));
    const events = [...madridIss, ...canarySentinel];

    const stationOrSatelliteVisible = filterGroundStationPassTimelineEvents(events, (stationId, satelliteLayerId) => (
        stationId === "station-canary" && satelliteLayerId === "sat-sentinel"
    ));
    assert.equal(stationOrSatelliteVisible.length, 3);
    assert.ok(stationOrSatelliteVisible.every((event) => event.stationId === "station-canary"));
    assert.deepEqual(filterGroundStationPassTimelineEvents(events, () => false), []);
    assert.deepEqual(filterGroundStationPassTimelineEvents(events, null), []);
});

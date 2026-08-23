import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const timeControlBarSource = readFileSync(
    new URL("../../../react-ui/src/features/simulation/TimeControlBar.jsx", import.meta.url),
    "utf8"
);
const markersSource = readFileSync(
    new URL("../../../react-ui/src/features/simulation/PassTimelineMarkers.jsx", import.meta.url),
    "utf8"
);

test("simulation timeline consumes the canonical aggregate stream and keeps completed markers while loading", () => {
    assert.match(timeControlBarSource, /GROUND_STATION_TIMELINE_EVENTS_EVENT/);
    assert.match(timeControlBarSource, /window\.addEventListener\(GROUND_STATION_TIMELINE_EVENTS_EVENT, sync\)/);
    assert.match(timeControlBarSource, /events:\s*status === "error" \? \[\] : normalizeGroundStationTimelineEvents\(detail\)/);
    assert.match(timeControlBarSource, /timelineEventState\.status !== "error"/);
});

test("pass timeline UI gives maximum elevation an upper green lane and AOS/LOS a lower purple lane", () => {
    assert.match(markersSource, /maximumMarkers\.map\(\(marker\) => markerButton\(marker, "upper"\)\)/);
    assert.match(markersSource, /boundaryMarkers\.map\(\(marker\) => markerButton\(marker, "lower"\)\)/);
    assert.match(markersSource, /#67ed9d/);
    assert.match(markersSource, /#be8cff/);
    assert.match(markersSource, /data-pass-event=\{marker\.eventType\}/);
});

test("every pass marker is keyboard-accessible, described by a tooltip, and seeks its exact event time", () => {
    assert.match(markersSource, /type="button"/);
    assert.match(markersSource, /aria-label=\{markerLabel\(marker, formatTime\)\}/);
    assert.match(markersSource, /aria-describedby=\{activeMarker\?\.id === marker\.id \? tooltipId : undefined\}/);
    assert.match(markersSource, /role="tooltip"/);
    assert.match(markersSource, /onClick=\{\(\) => onJump\(marker\)\}/);
    assert.match(timeControlBarSource, /eventType: marker\.eventType/);
    assert.match(timeControlBarSource, /time: new Date\(marker\.time\)\.toISOString\(\)/);
});

test("simulation timeline keeps native scrubbing and adds wheel and rail-drag navigation", () => {
    assert.match(timeControlBarSource, /timelineStepFromPointer/);
    assert.match(timeControlBarSource, /timelineStepFromWheel/);
    assert.match(timeControlBarSource, /onWheel=\{wheelTimelineNavigation\}/);
    assert.match(timeControlBarSource, /onPointerDown=\{beginTimelinePointerNavigation\}/);
    assert.match(timeControlBarSource, /onPointerMove=\{moveTimelinePointerNavigation\}/);
    assert.match(timeControlBarSource, /onChange=\{\(event\) => seekTimelineStep\(Number\(event\.target\.value\)\)\}/);
});

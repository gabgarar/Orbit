import assert from "node:assert/strict";
import test from "node:test";

import { parseOemEphemerisContent } from "../../js/satellites.js";

const header = (frame, originator = "Orbit", comments = "") => [
    "CCSDS_OEM_VERS = 2.0",
    `ORIGINATOR = ${originator}`,
    "META_START",
    "OBJECT_NAME = TEST",
    "CENTER_NAME = EARTH",
    `REF_FRAME = ${frame}`,
    "TIME_SYSTEM = UTC",
    "META_STOP",
    comments
].filter(Boolean).join("\n");

test("standard OEM km/km/s is converted to Orbit runtime metres and ITRF remains earth-fixed", () => {
    const parsed = parseOemEphemerisContent(`${header("ITRF", "Orbit", "COMMENT = ORBIT_POSITION_UNIT = km\nCOMMENT = ORBIT_VELOCITY_UNIT = km/s")}\n2026-01-01T00:00:00Z 6378.137 0 0 7.5 0 0`);

    assert.equal(parsed.metadata.refFrame, "ITRF");
    assert.equal(parsed.metadata.positionUnit, "km");
    assert.deepEqual(parsed.points[0], {
        timeMs: Date.parse("2026-01-01T00:00:00Z"),
        x: 6378137,
        y: 0,
        z: 0,
        velocity: { x: 7500, y: 0, z: 0 }
    });
});

test("legacy Orbit metre OEM is kept compatible and corrected to its actual earth-fixed frame", () => {
    const parsed = parseOemEphemerisContent(`${header("TEME")}\n2026-01-01T00:00:00Z 6378137 0 0 7500 0 0`);

    assert.equal(parsed.metadata.positionUnit, "m");
    assert.equal(parsed.metadata.legacyOrbitEcef, true);
    assert.equal(parsed.metadata.refFrame, "ITRF");
    assert.equal(parsed.points[0].x, 6378137);
    assert.equal(parsed.points[0].velocity?.x, 7500);
});

test("third-party TEME OEM is never relabelled as ECEF", () => {
    const parsed = parseOemEphemerisContent(`${header("TEME", "External lab")}\n2026-01-01T00:00:00Z 6378 0 0 7.5 0 0`);

    assert.equal(parsed.metadata.refFrame, "TEME");
    assert.equal(parsed.metadata.legacyOrbitEcef, false);
    assert.equal(parsed.points[0].x, 6378000);
});

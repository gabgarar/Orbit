import assert from "node:assert/strict";
import test from "node:test";

import { deriveTleOrbitalMetrics, getTleChecksum } from "../../js/features/objectDetails/tleMetrics.js";

const ISS_LINE_1 = "1 25544U 98067A   24140.51782528  .00016717  00000+0  30143-3 0  9994";
const ISS_LINE_2 = "2 25544  51.6393 204.0571 0003585  73.6640 286.4919 15.50036215453228";

test("derives physical orbital values from TLE mean motion and eccentricity", () => {
    const metrics = deriveTleOrbitalMetrics({
        line1: ISS_LINE_1,
        line2: ISS_LINE_2,
        meanMotionRevDay: "15.50036215",
        eccentricity: "0.0003585",
        revolutionNumberAtEpoch: "45322"
    });

    assert.equal(metrics.revolutionNumberAtEpoch, "45322");
    assert.ok(Math.abs(metrics.periodMinutes - 92.901) < 0.01);
    assert.ok(Math.abs(metrics.semiMajorAxisKm - 6794.8) < 1);
    assert.ok(metrics.perigeeKm < metrics.apogeeKm);
    assert.ok(Math.abs(metrics.meanMotionRadSec - 0.001127) < 0.00001);
    assert.equal(metrics.line1Checksum?.valid, true);
    assert.equal(metrics.line2Checksum?.valid, true);
});

test("returns missing values instead of fabricated TLE derivatives", () => {
    const metrics = deriveTleOrbitalMetrics({ meanMotionRevDay: "-", eccentricity: "-" });

    assert.equal(metrics.periodMinutes, null);
    assert.equal(metrics.semiMajorAxisKm, null);
    assert.equal(metrics.perigeeKm, null);
    assert.equal(metrics.apogeeKm, null);
    assert.equal(metrics.meanMotionRadSec, null);
    assert.equal(getTleChecksum("incomplete"), null);
});

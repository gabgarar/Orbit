import assert from "node:assert/strict";
import test from "node:test";

import { calculateFreeSpacePathLossDb, calculateGeoDistanceKm } from "../../js/features/groundStations/geometry.js";

test("free-space path loss is positive for valid inputs", () => {
    assert.ok(calculateFreeSpacePathLossDb(2200, 1000) > 0);
});

test("geographic distance is zero for the same coordinates", () => {
    assert.equal(calculateGeoDistanceKm(40.4168, -3.7038, 40.4168, -3.7038), 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import { tleEpochAgeMs, tleEpochToDate } from "../../js/features/objectDetails/tleEpoch.js";

test("TLE epoch parser accepts a leap-year day and keeps it in UTC", () => {
    const epoch = tleEpochToDate("24366.50000000");

    assert.equal(epoch?.toISOString(), "2024-12-31T12:00:00.000Z");
});

test("TLE epoch parser rejects impossible days instead of rolling into another year", () => {
    assert.equal(tleEpochToDate("25366.50000000"), null);
    assert.equal(tleEpochToDate("24367.00000000"), null);
    assert.equal(tleEpochToDate("25000.00000000"), null);
    assert.equal(tleEpochToDate("25abc.00000000"), null);
});

test("TLE epoch age stays unavailable when the epoch is invalid", () => {
    const reference = Date.parse("2026-01-01T00:00:00.000Z");

    assert.equal(tleEpochAgeMs("25366.50000000", reference), null);
    assert.equal(tleEpochAgeMs("26001.00000000", reference), 0);
});

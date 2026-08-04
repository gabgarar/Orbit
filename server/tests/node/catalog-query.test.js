import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DECAY_PERIGEE_KM, filterCatalogEntries, getNoradId, inferMission, inferOrbitKind, ORBIT_KIND, resolveDecayPerigeeKm } from "../../src/catalog/query.js";

const tleLine2 = (noradId, meanMotion) => `2 ${noradId}`.padEnd(52, " ") + meanMotion;
const entries = [
    { name: "STARLINK-1000", line1: "1 12345U", line2: tleLine2("12345", "15.00000000"), operator: "spacex", owner: "spacex", perigee_km: 550 },
    { name: "NOAA 19", line1: "1 33591U", line2: tleLine2("33591", "14.00000000"), operator: "unknown", owner: "unknown", perigee_km: null },
    { name: "DECAYING TEST", line1: "1 99999U", line2: tleLine2("99999", "16.00000000"), operator: "unknown", owner: "unknown", perigee_km: 180 }
];

test("catalog query identifies NORAD IDs and known metadata", () => {
    assert.equal(getNoradId(entries[0]), "12345");
    assert.equal(inferMission("NOAA 19"), "weather");
    assert.equal(inferOrbitKind(entries[0].line2), ORBIT_KIND.LEO);
});

test("decay filtering excludes entries whose perigee is unavailable", () => {
    const results = filterCatalogEntries(entries, { search: "", orbitKind: "", mission: "", operator: "", owner: "", decayOnly: true, decayPerigeeKm: 200 });
    assert.deepEqual(results.map((entry) => entry.name), ["DECAYING TEST"]);
});

test("catalog search accepts names and unpadded NORAD fragments", () => {
    const results = filterCatalogEntries(entries, { search: "12345", orbitKind: "", mission: "", operator: "", owner: "", decayOnly: false });
    assert.deepEqual(results.map((entry) => entry.name), ["STARLINK-1000"]);
});

test("decay thresholds fall back safely for blank and non-finite configuration", () => {
    assert.equal(resolveDecayPerigeeKm(""), DEFAULT_DECAY_PERIGEE_KM);
    assert.equal(resolveDecayPerigeeKm(null), DEFAULT_DECAY_PERIGEE_KM);
    assert.equal(resolveDecayPerigeeKm(Infinity), DEFAULT_DECAY_PERIGEE_KM);
    assert.equal(resolveDecayPerigeeKm(-1), DEFAULT_DECAY_PERIGEE_KM);
    assert.equal(resolveDecayPerigeeKm(0), 0);

    const results = filterCatalogEntries(entries, { decayOnly: true, decayPerigeeKm: "" });
    assert.deepEqual(results.map((entry) => entry.name), ["DECAYING TEST"]);
});

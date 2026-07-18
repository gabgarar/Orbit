import assert from "node:assert/strict";
import test from "node:test";
import { parseTleCatalog } from "../../src/catalog/parsers.js";

const line1 = "1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996";
const line2 = "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395";

test("TLE parser accepts standard two-line records without a name", () => {
    assert.deepEqual(parseTleCatalog(`${line1}\n${line2}`), [{
        name: "NORAD 48843",
        line1,
        line2,
        sourceFormat: "TLE"
    }]);
});

test("TLE parser resynchronizes after comments and supports the optional zero name prefix", () => {
    const entries = parseTleCatalog(`0 FIRST SATELLITE\n${line1}\n${line2}\n# source separator\nSECOND SATELLITE\n${line1}\n${line2}`);

    assert.deepEqual(entries.map((entry) => entry.name), ["FIRST SATELLITE", "SECOND SATELLITE"]);
    assert.deepEqual(entries.map((entry) => entry.line1), [line1, line1]);
    assert.deepEqual(entries.map((entry) => entry.line2), [line2, line2]);
});

test("TLE parser rejects a truncated final record without blocking the event loop", () => {
    assert.deepEqual(parseTleCatalog("BROKEN RECORD\n1 25544U"), []);
});

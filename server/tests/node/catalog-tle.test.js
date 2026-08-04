import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTleEntries } from "../../src/catalog/tle.js";

const line1 = "1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996";
const line2 = "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395";

test("catalog entry resolution gives CUSTOM priority independently of input order", () => {
    const catalogEntry = { name: "REMOTE", line1, line2, sourceOrigin: "CATALOG" };
    const customEntry = { name: "CUSTOM", line1, line2, sourceOrigin: "CUSTOM" };

    for (const entries of [[catalogEntry, customEntry], [customEntry, catalogEntry]]) {
        const normalized = normalizeTleEntries(entries);
        assert.equal(normalized.length, 1);
        assert.equal(normalized[0].name, "CUSTOM");
    }
});

test("catalog entry resolution preserves the first entry when origins are equal", () => {
    const first = { name: "FIRST CUSTOM", line1, line2, sourceOrigin: "CUSTOM" };
    const second = { name: "SECOND CUSTOM", line1, line2, sourceOrigin: "CUSTOM" };

    assert.equal(normalizeTleEntries([first, second])[0].name, "FIRST CUSTOM");
});

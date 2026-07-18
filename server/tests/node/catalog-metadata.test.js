import test from "node:test";
import assert from "node:assert/strict";
import { getPerigeeKm, withCatalogMetadata } from "../../src/catalog/metadata.js";

const line2 = "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395";

test("catalog metadata derives perigee when a stored value is null or blank", () => {
    const estimatedPerigee = getPerigeeKm({ line2, perigee_km: null });
    const metadata = withCatalogMetadata({
        name: "  STARLINK TEST  ",
        line1: "1 48843U",
        line2,
        perigee_km: "",
        sourceFormat: " omm ",
        sourceOrigin: " custom ",
        operator: "  ",
        owner: "  "
    });

    assert.ok(estimatedPerigee > 0);
    assert.equal(metadata.perigee_km, estimatedPerigee);
    assert.equal(metadata.sourceFormat, "OMM");
    assert.equal(metadata.sourceOrigin, "CUSTOM");
    assert.equal(metadata.operator, "spacex");
    assert.equal(metadata.owner, "spacex");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogPageService } from "../../src/catalog/page-service.js";

const entries = [
    { name: "Custom TLE", line1: "1 10001U", line2: "2 10001", sourceFormat: "TLE", sourceOrigin: "CUSTOM", operator: "operator-a", owner: "owner-a", perigee_km: 150 },
    { name: "Catalog OMM", line1: "1 10002U", line2: "2 10002", sourceFormat: "OMM", sourceOrigin: "CATALOG", operator: "operator-b", owner: "owner-b", perigee_km: 400 },
    { name: "Catalog TLE", line1: "1 10003U", line2: "2 10003", sourceFormat: "TLE", sourceOrigin: "CATALOG", operator: "operator-a", owner: "owner-a", perigee_km: null }
];

test("catalog page service combines source filters, pagination, and decay metadata", async () => {
    const service = createCatalogPageService({
        catalog: { get: async () => ({ entries }) },
        config: { get: async () => ({ data: { decay_alert_perigee_km: 200 } }) }
    });
    const page = await service.getPage({ sourceFormat: "tle", sourceOrigin: "custom", limit: "1" });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].name, "Custom TLE");
    assert.equal(page.items[0].noradId, "10001");
    assert.equal(page.items[0].decayRisk, true);
    assert.deepEqual(page.operators, ["operator-a", "operator-b"]);
});

test("catalog page service ignores unsupported source filters", async () => {
    const service = createCatalogPageService({
        catalog: { get: async () => ({ entries }) },
        config: { get: async () => ({ data: {} }) }
    });
    const page = await service.getPage({ sourceFormat: "unknown", sourceOrigin: "invalid", offset: "1", limit: "1" });
    assert.equal(page.total, 3);
    assert.equal(page.items[0].name, "Catalog OMM");
    assert.equal(page.hasMore, true);
});

test("catalog page avoids false decay alerts when perigee metadata is absent", async () => {
    const service = createCatalogPageService({
        catalog: {
            get: async () => ({
                entries: [{
                    name: "High Orbit",
                    line1: "1 48843U",
                    line2: "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395",
                    perigee_km: null
                }]
            })
        },
        config: { get: async () => ({ data: { decay_alert_perigee_km: 200 } }) }
    });

    const page = await service.getPage({});

    assert.equal(page.items[0].decayRisk, false);
});

test("catalog page uses the default decay threshold for malformed persisted values", async () => {
    const service = createCatalogPageService({
        catalog: { get: async () => ({ entries: [entries[0]] }) },
        config: { get: async () => ({ data: { decay_alert_perigee_km: "" } }) }
    });

    const page = await service.getPage({ decayOnly: "true" });

    assert.equal(page.decayPerigeeKm, 200);
    assert.equal(page.items[0].decayRisk, true);
    assert.equal(page.total, 1);
});

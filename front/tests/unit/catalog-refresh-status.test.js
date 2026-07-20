import assert from "node:assert/strict";
import test from "node:test";

import {
    formatCatalogRefreshCountdown,
    getCatalogRefreshRetryAt
} from "../../js/features/catalog/refreshStatus.js";

test("catalog refresh prefers the server retry instant", () => {
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    assert.equal(
        getCatalogRefreshRetryAt({ retryAt: "2026-07-20T13:30:00.000Z", retryAfterMs: 1 }, now),
        Date.parse("2026-07-20T13:30:00.000Z")
    );
});

test("catalog refresh falls back to structured duration and legacy message", () => {
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    assert.equal(getCatalogRefreshRetryAt({ retryAfterMs: 90_000 }, now), now + 90_000);
    assert.equal(getCatalogRefreshRetryAt({ error: "Reintenta dentro de 17 minutos." }, now), now + (17 * 60_000));
});

test("catalog refresh countdown is compact and expires cleanly", () => {
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    assert.equal(formatCatalogRefreshCountdown(now + 61_000, now), "1 min 01 s");
    assert.equal(formatCatalogRefreshCountdown(now, now), "ahora");
});

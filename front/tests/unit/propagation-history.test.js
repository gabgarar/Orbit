import assert from "node:assert/strict";
import test from "node:test";

import {
    createPropagationHistoryEntry,
    MAX_PROJECT_PROPAGATION_HISTORY_ENTRIES,
    normalizePropagationHistory,
    updatePropagationHistoryEntry
} from "../../js/features/propagatedParameters/propagationHistory.js";

const startedAt = "2026-08-26T10:00:00.000Z";
const completedAt = "2026-08-26T10:00:04.000Z";

function entry(id, updatedAt = startedAt) {
    return {
        id,
        status: "running",
        startedAt,
        updatedAt,
        target: { id: "25544", name: "ISS" },
        source: "TLE",
        propagator: "sgp4",
        range: {
            mode: "simulation-range",
            startTime: "2026-08-26T00:00:00.000Z",
            endTime: "2026-08-26T02:00:00.000Z"
        },
        sampling: { mode: "selected", requestedIntervalSeconds: 60, effectiveIntervalSeconds: 60, sampleCount: 121 }
    };
}

test("propagation history retains compact audit metadata and excludes raw samples", () => {
    const normalized = normalizePropagationHistory([{
        ...entry("propagation:1"),
        result: {
            sampleCount: 121,
            outputFrame: "TEME",
            samples: [{ x: 7000, y: 1 }]
        },
        response: { samples: [{ x: 7000 }] },
        samples: [{ x: 7000 }],
        secret: "must-not-persist"
    }]);

    assert.equal(normalized.length, 1);
    assert.deepEqual(normalized[0], {
        id: "propagation:1",
        status: "running",
        startedAt,
        updatedAt: startedAt,
        target: { id: "25544", name: "ISS" },
        source: "TLE",
        propagator: "sgp4",
        range: {
            mode: "simulation-range",
            startTime: "2026-08-26T00:00:00.000Z",
            endTime: "2026-08-26T02:00:00.000Z"
        },
        sampling: { mode: "selected", requestedIntervalSeconds: 60, effectiveIntervalSeconds: 60, sampleCount: 121 },
        result: { sampleCount: 121, outputFrame: "TEME" }
    });
    assert.equal("samples" in normalized[0], false);
    assert.equal("response" in normalized[0], false);
    assert.equal("secret" in normalized[0], false);
});

test("a running propagation is finalized without replacing independent rows", () => {
    const initial = normalizePropagationHistory([
        entry("propagation:older", "2026-08-26T09:00:00.000Z"),
        entry("propagation:current", startedAt)
    ]);
    const final = updatePropagationHistoryEntry(initial, "propagation:current", {
        status: "completed",
        finishedAt: completedAt,
        updatedAt: completedAt,
        message: "Parámetros propagados calculados.",
        result: { sampleCount: 721, outputFrame: "ITRF", nativeFrame: "TEME" }
    });

    assert.equal(final.length, 2);
    assert.equal(final[0].id, "propagation:current");
    assert.equal(final[0].status, "completed");
    assert.equal(final[0].finishedAt, completedAt);
    assert.deepEqual(final[0].result, { sampleCount: 721, outputFrame: "ITRF", nativeFrame: "TEME" });
    assert.equal(final[1].id, "propagation:older");
    assert.equal(final[1].status, "running");
});

test("propagation history is bounded, de-duplicated and accepts old documents without the field", () => {
    assert.deepEqual(normalizePropagationHistory(undefined), []);
    const entries = Array.from({ length: MAX_PROJECT_PROPAGATION_HISTORY_ENTRIES + 5 }, (_, index) => entry(
        `propagation:${index}`,
        new Date(Date.parse(startedAt) + (index * 1000)).toISOString()
    ));
    entries.push({ ...entry("propagation:3"), status: "failed", updatedAt: "2026-08-27T00:00:00.000Z", error: "latest duplicate" });
    const normalized = normalizePropagationHistory(entries);

    assert.equal(normalized.length, MAX_PROJECT_PROPAGATION_HISTORY_ENTRIES);
    assert.equal(normalized[0].id, "propagation:3");
    assert.equal(normalized[0].status, "failed");
    assert.equal(normalized.some((item) => item.id === "propagation:0"), false);
});

test("new audit entries require an id and receive an ISO lifecycle timestamp", () => {
    assert.equal(createPropagationHistoryEntry({ status: "running" }), null);
    const created = createPropagationHistoryEntry({ id: "propagation:new", target: { name: "Design orbit" } }, {
        now: new Date(startedAt)
    });
    assert.equal(created.id, "propagation:new");
    assert.equal(created.status, "running");
    assert.equal(created.startedAt, startedAt);
    assert.equal(created.updatedAt, startedAt);
});

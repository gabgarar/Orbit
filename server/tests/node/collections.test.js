import test from "node:test";
import assert from "node:assert/strict";
import { getUniqueSorted, runWithConcurrency } from "../../src/shared/collections.js";

test("getUniqueSorted normalizes iterable text values and ignores blanks", () => {
    const values = new Set([" Beta ", "alpha", "ALPHA", "", "   ", null, undefined]);

    assert.deepEqual(getUniqueSorted(values), ["alpha", "beta"]);
    assert.deepEqual(getUniqueSorted(" Orbit "), ["orbit"]);
    assert.deepEqual(getUniqueSorted(null), []);
});

test("runWithConcurrency honors the worker limit for iterable input", async () => {
    const processed = [];
    let activeWorkers = 0;
    let peakWorkers = 0;

    await runWithConcurrency(new Set([1, 2, 3, 4, 5]), 2, async (item) => {
        activeWorkers += 1;
        peakWorkers = Math.max(peakWorkers, activeWorkers);
        await new Promise((resolve) => setTimeout(resolve, 5));
        processed.push(item);
        activeWorkers -= 1;
    });

    assert.equal(peakWorkers, 2);
    assert.deepEqual(processed.sort((left, right) => left - right), [1, 2, 3, 4, 5]);
});

test("runWithConcurrency falls back safely for invalid limits and workers", async () => {
    const processed = [];
    await runWithConcurrency(["first", "second"], 0.5, async (item) => {
        processed.push(item);
    });

    assert.deepEqual(processed, ["first", "second"]);
    await runWithConcurrency(["third"], Symbol("limit"), async (item) => {
        processed.push(item);
    });
    assert.deepEqual(processed, ["first", "second", "third"]);
    await assert.rejects(
        runWithConcurrency([], 1, null),
        { name: "TypeError", message: "runWithConcurrency requires a worker function." }
    );
});

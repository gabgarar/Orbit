function toSnapshot(values) {
    if (values == null) return [];
    if (typeof values === "string") return [values];
    return typeof values[Symbol.iterator] === "function" ? Array.from(values) : [];
}

function normalizeText(value) {
    return value == null ? "" : String(value).trim().toLowerCase();
}

function resolveWorkerCount(limit, itemCount) {
    let requested = 1;
    try {
        const parsed = Number(limit);
        if (Number.isFinite(parsed) && parsed > 0) requested = Math.max(1, Math.floor(parsed));
    } catch {
        // Invalid numeric coercions use the safe sequential fallback.
    }
    return Math.min(requested, itemCount);
}

export function getUniqueSorted(values) {
    const uniqueValues = new Set();
    for (const value of toSnapshot(values)) {
        const normalized = normalizeText(value);
        if (normalized) uniqueValues.add(normalized);
    }
    return [...uniqueValues].sort();
}

export async function runWithConcurrency(items, limit, worker) {
    if (typeof worker !== "function") throw new TypeError("runWithConcurrency requires a worker function.");

    const queue = toSnapshot(items);
    const workerCount = resolveWorkerCount(limit, queue.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < queue.length) {
            const item = queue[nextIndex];
            nextIndex += 1;
            await worker(item);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, runWorker));
}

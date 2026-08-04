import test from "node:test";
import assert from "node:assert/strict";
import {
    CATALOG_REFRESH_LAST_ATTEMPT_KEY,
    createCatalogRefreshService,
    MAX_TIMER_DELAY_MS,
    resolveAutoRefreshIntervalMs
} from "../../src/catalog/refresh-service.js";
import { computeTleChecksum } from "../../src/catalog/tle.js";

const validEntry = {
    name: "TEST SATELLITE",
    line1: "1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996",
    line2: "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395",
    sourceFormat: "TLE"
};

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function lineForNorad(template, noradId) {
    const body = `${template.slice(0, 2)}${String(noradId).padStart(5, "0")}${template.slice(7, 68)}`;
    return `${body}${computeTleChecksum(`${body}0`)}`;
}

function createService(overrides = {}) {
    return createCatalogRefreshService({
        catalog: {
            get: async () => ({ entries: [] }),
            replace: async () => {}
        },
        config: { get: async () => ({ data: {} }) },
        serialize: {},
        reloadPython: async () => {},
        logger,
        defaultGroups: [],
        defaultSources: [],
        download: async () => ({ entries: [] }),
        ...overrides
    });
}

test("catalog refresh keeps a custom entry when a remote source has the same NORAD ID", async () => {
    let savedEntries;
    let reloads = 0;
    const customEntry = { ...validEntry, name: "CUSTOM SATELLITE", sourceOrigin: "CUSTOM" };
    const service = createService({
        config: { get: async () => ({ data: {} }) },
        catalog: {
            get: async () => ({ entries: [customEntry] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        reloadPython: async () => { reloads += 1; },
        defaultGroups: ["test-group"],
        download: async () => ({ entries: [{ ...validEntry, name: "REMOTE SATELLITE" }] })
    });

    const result = await service.refresh();

    assert.equal(result.ok, true);
    assert.equal(result.preservedCustomEntries, 1);
    assert.equal(result.writtenEntries, 1);
    assert.equal(savedEntries[0].name, "CUSTOM SATELLITE");
    assert.equal(savedEntries[0].sourceOrigin, "CUSTOM");
    assert.equal(reloads, 1);
});

test("catalog refresh stamps each remote entry with its provider, source, and refresh timestamp", async () => {
    const refreshedAt = Date.UTC(2026, 6, 19, 10, 15, 0);
    let savedEntries;
    const service = createService({
        catalog: {
            get: async () => ({ entries: [] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        defaultGroups: ["active"],
        now: () => refreshedAt,
        download: async () => ({ entries: [validEntry] })
    });

    const result = await service.refresh();

    assert.equal(result.ok, true);
    assert.equal(savedEntries.length, 1);
    assert.equal(savedEntries[0].sourceOrigin, "CATALOG");
    assert.equal(savedEntries[0].tleSource, "CelesTrak");
    assert.equal(savedEntries[0].sourceProvider, "CelesTrak");
    assert.equal(savedEntries[0].sourceName, "active");
    assert.equal(savedEntries[0].updatedAt, "2026-07-19T10:15:00.000Z");
});

test("catalog refresh respects offline mode before downloading", async () => {
    let downloads = 0;
    const service = createService({
        config: { get: async () => ({ data: { offline_mode: true } }) },
        download: async () => { downloads += 1; return { entries: [] }; }
    });

    const result = await service.refresh();

    assert.equal(result.status, 409);
    assert.equal(downloads, 0);
});

test("catalog refresh reports a persisted-but-not-reloaded backend", async () => {
    let savedEntries;
    const service = createService({
        catalog: {
            get: async () => ({ entries: [] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        defaultGroups: ["test-group"],
        download: async () => ({ entries: [validEntry] }),
        reloadPython: async () => false
    });

    const result = await service.refresh();

    assert.equal(savedEntries.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.persisted, true);
    assert.match(result.error, /backend de propagacion no pudo recargarse/);
});

test("catalog refresh preserves the prior catalog when every remote download fails", async () => {
    const existingEntries = [
        { ...validEntry, name: "PREVIOUS CATALOG", sourceOrigin: "CATALOG" },
        { ...validEntry, name: "PREVIOUS CUSTOM", sourceOrigin: "CUSTOM" }
    ];
    let replaceCalls = 0;
    const service = createService({
        catalog: {
            get: async () => ({ entries: existingEntries }),
            replace: async () => { replaceCalls += 1; }
        },
        defaultGroups: ["unavailable"],
        download: async () => { throw new Error("network unavailable"); }
    });

    const result = await service.refresh();

    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.equal(replaceCalls, 0);
    assert.deepEqual(existingEntries.map((entry) => entry.name), ["PREVIOUS CATALOG", "PREVIOUS CUSTOM"]);
});

test("catalog refresh retains prior catalog entries for sources that fail during a partial refresh", async () => {
    const previousCatalog = {
        ...validEntry,
        name: "PREVIOUS CATALOG",
        line1: lineForNorad(validEntry.line1, 1),
        line2: lineForNorad(validEntry.line2, 1),
        sourceOrigin: "CATALOG"
    };
    const customEntry = {
        ...validEntry,
        name: "CUSTOM ENTRY",
        line1: lineForNorad(validEntry.line1, 2),
        line2: lineForNorad(validEntry.line2, 2),
        sourceOrigin: "CUSTOM"
    };
    const downloadedEntry = {
        ...validEntry,
        name: "FRESH CATALOG",
        line1: lineForNorad(validEntry.line1, 3),
        line2: lineForNorad(validEntry.line2, 3),
        sourceOrigin: "CATALOG"
    };
    let savedEntries;
    const service = createService({
        catalog: {
            get: async () => ({ entries: [previousCatalog, customEntry] }),
            replace: async (entries) => { savedEntries = entries; }
        },
        defaultGroups: ["unavailable", "available"],
        download: async (source) => {
            if (source.group === "unavailable") throw new Error("network unavailable");
            return { entries: [downloadedEntry] };
        }
    });

    const result = await service.refresh();

    assert.equal(result.ok, true);
    assert.equal(result.preservedCatalogEntries, 1);
    assert.deepEqual(savedEntries.map((entry) => entry.name), ["CUSTOM ENTRY", "FRESH CATALOG", "PREVIOUS CATALOG"]);
});

test("catalog refresh honors a persisted attempt timestamp before downloading", async () => {
    const currentTime = 10 * 60 * 60 * 1000;
    let downloads = 0;
    const service = createService({
        config: {
            get: async () => ({ data: { [CATALOG_REFRESH_LAST_ATTEMPT_KEY]: currentTime - (60 * 60 * 1000) } })
        },
        now: () => currentTime,
        download: async () => { downloads += 1; return { entries: [] }; }
    });

    const result = await service.refresh();

    assert.equal(result.status, 429);
    assert.equal(result.rateLimited, true);
    assert.equal(result.retryAfterMs, 60 * 60 * 1000);
    assert.equal(result.retryAt, "1970-01-01T11:00:00.000Z");
    assert.equal(downloads, 0);
});

test("catalog refresh persists each real remote attempt in the volume-backed configuration", async () => {
    const attemptedAt = 42_000;
    let savedConfig;
    const service = createService({
        config: {
            get: async () => ({ system: { language: "es" }, data: {} }),
            save: async (config) => { savedConfig = config; }
        },
        now: () => attemptedAt,
        defaultGroups: ["test-group"],
        download: async () => ({ entries: [validEntry] })
    });

    const result = await service.refresh();

    assert.equal(result.ok, true);
    assert.deepEqual(savedConfig, {
        system: { language: "es" },
        data: { [CATALOG_REFRESH_LAST_ATTEMPT_KEY]: attemptedAt }
    });
});

test("catalog refresh persists its timestamp into the latest serialized configuration", async () => {
    const attemptedAt = 42_000;
    let savedConfig;
    const service = createService({
        config: {
            get: async () => ({ system: { language: "es" }, data: {} }),
            update: async (mutator) => {
                savedConfig = await mutator({
                    system: { language: "en" },
                    data: { offline_mode: true, satellites_catalog_file: "latest.json" }
                });
                return savedConfig;
            }
        },
        now: () => attemptedAt,
        defaultGroups: [],
        defaultSources: []
    });

    const result = await service.refresh();

    assert.equal(result.ok, false);
    assert.deepEqual(savedConfig, {
        system: { language: "en" },
        data: {
            offline_mode: true,
            satellites_catalog_file: "latest.json",
            [CATALOG_REFRESH_LAST_ATTEMPT_KEY]: attemptedAt
        }
    });
});

test("catalog refresh stop aborts an active download without persisting catalog data or reloading Python", async () => {
    let beginDownload;
    let downloadSignal;
    let writes = 0;
    let reloads = 0;
    const downloadStarted = new Promise((resolve) => { beginDownload = resolve; });
    const service = createService({
        catalog: {
            get: async () => ({ entries: [] }),
            replace: async () => { writes += 1; }
        },
        defaultGroups: ["test-group"],
        download: async (_source, { signal }) => {
            downloadSignal = signal;
            beginDownload();
            return new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("download aborted")), { once: true });
            });
        },
        reloadPython: async () => { reloads += 1; }
    });

    const refreshing = service.refresh();
    await downloadStarted;
    const stopping = service.stop();
    const result = await refreshing;
    await stopping;

    assert.equal(downloadSignal.aborted, true);
    assert.equal(result.cancelled, true);
    assert.equal(writes, 0);
    assert.equal(reloads, 0);
});

test("catalog refresh stop waits for an in-flight downloader that does not honor AbortSignal", async () => {
    let beginDownload;
    let releaseDownload;
    let abortObserved = false;
    let writes = 0;
    const downloadStarted = new Promise((resolve) => { beginDownload = resolve; });
    const downloaded = new Promise((resolve) => { releaseDownload = resolve; });
    const service = createService({
        catalog: {
            get: async () => ({ entries: [] }),
            replace: async () => { writes += 1; }
        },
        defaultGroups: ["test-group"],
        download: async (_source, { signal }) => {
            signal.addEventListener("abort", () => { abortObserved = true; }, { once: true });
            beginDownload();
            return downloaded;
        }
    });

    const refreshing = service.refresh();
    await downloadStarted;
    let stopped = false;
    const stopping = service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(abortObserved, true);
    assert.equal(stopped, false);

    releaseDownload({ entries: [validEntry] });
    const result = await refreshing;
    await stopping;

    assert.equal(result.cancelled, true);
    assert.equal(writes, 0);
    assert.equal(stopped, true);
});

test("catalog refresh does not start after stop until the runtime schedules it again", async () => {
    let downloads = 0;
    const service = createService({
        config: { get: async () => ({ data: { tle_auto_update_enabled: false } }) },
        defaultGroups: ["test-group"],
        download: async () => {
            downloads += 1;
            return { entries: [validEntry] };
        }
    });

    await service.stop();
    const blocked = await service.refresh();
    assert.equal(blocked.cancelled, true);
    assert.equal(downloads, 0);

    await service.schedule();
    const refreshed = await service.refresh();
    assert.equal(refreshed.ok, true);
    assert.equal(downloads, 1);
});

test("auto refresh intervals reject non-finite and invalid configuration values", () => {
    const hour = 60 * 60 * 1000;
    assert.equal(resolveAutoRefreshIntervalMs(Infinity), 12 * hour);
    assert.equal(resolveAutoRefreshIntervalMs(Number.NaN), 12 * hour);
    assert.equal(resolveAutoRefreshIntervalMs(-1), 12 * hour);
    assert.equal(resolveAutoRefreshIntervalMs(undefined, Infinity), 12 * hour);
    assert.equal(resolveAutoRefreshIntervalMs(1), 2 * hour);
    assert.equal(resolveAutoRefreshIntervalMs(3), 3 * hour);
});

test("auto refresh intervals cap finite values at the Node timer limit", () => {
    assert.equal(resolveAutoRefreshIntervalMs(Number.MAX_VALUE), MAX_TIMER_DELAY_MS);
    assert.equal(resolveAutoRefreshIntervalMs(1_000_000), MAX_TIMER_DELAY_MS);
});

test("catalog refresh scheduling resumes from its persisted attempt timestamp and releases its timer", async () => {
    const currentTime = 30 * 60 * 60 * 1000;
    let scheduled;
    const clearedTimeouts = [];
    const clearedIntervals = [];
    const service = createService({
        config: {
            get: async () => ({
                data: {
                    tle_auto_update_enabled: true,
                    tle_auto_update_hours: Infinity,
                    [CATALOG_REFRESH_LAST_ATTEMPT_KEY]: currentTime - (3 * 60 * 60 * 1000)
                }
            })
        },
        now: () => currentTime,
        setTimeoutImpl: (callback, delay) => {
            scheduled = { callback, delay };
            return "catalog-refresh-delay";
        },
        setIntervalImpl: (callback, delay) => {
            return "catalog-refresh-timer";
        },
        clearTimeoutImpl: (timer) => { clearedTimeouts.push(timer); },
        clearIntervalImpl: (timer) => { clearedIntervals.push(timer); }
    });

    await service.schedule();
    service.stop();

    assert.equal(typeof scheduled.callback, "function");
    assert.equal(scheduled.delay, 9 * 60 * 60 * 1000);
    assert.deepEqual(clearedTimeouts, ["catalog-refresh-delay"]);
    assert.deepEqual(clearedIntervals, []);
});

test("catalog refresh scheduling ignores stale configuration reads and callbacks after stop", async () => {
    const pendingReads = [];
    const scheduled = [];
    const intervals = [];
    const service = createService({
        config: {
            get: () => new Promise((resolve) => pendingReads.push(resolve))
        },
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            scheduled.push(timer);
            return timer;
        },
        setIntervalImpl: (callback, delay) => {
            const timer = { callback, delay };
            intervals.push(timer);
            return timer;
        },
        clearTimeoutImpl: () => {},
        clearIntervalImpl: () => {}
    });
    const enabled = { data: { tle_auto_update_enabled: true, tle_auto_update_hours: 12 } };

    const firstSchedule = service.schedule();
    const secondSchedule = service.schedule();
    pendingReads.shift()(enabled);
    await firstSchedule;
    assert.equal(scheduled.length, 0);

    pendingReads.shift()(enabled);
    await secondSchedule;
    assert.equal(scheduled.length, 1);

    service.stop();
    scheduled[0].callback();
    assert.equal(intervals.length, 0);
});

test("catalog refresh stop clears its active interval and invalidates its callback", async () => {
    const scheduled = [];
    const intervals = [];
    const clearedTimeouts = [];
    const clearedIntervals = [];
    let configReads = 0;
    const service = createService({
        config: {
            get: async () => {
                configReads += 1;
                return { data: { tle_auto_update_enabled: true, tle_auto_update_hours: 12 } };
            }
        },
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            scheduled.push(timer);
            return timer;
        },
        setIntervalImpl: (callback, delay) => {
            const timer = { callback, delay };
            intervals.push(timer);
            return timer;
        },
        clearTimeoutImpl: (timer) => { clearedTimeouts.push(timer); },
        clearIntervalImpl: (timer) => { clearedIntervals.push(timer); }
    });

    await service.schedule();
    scheduled[0].callback();
    assert.equal(intervals.length, 1);
    const readsBeforeStop = configReads;

    service.stop();
    intervals[0].callback();

    assert.deepEqual(clearedTimeouts, []);
    assert.deepEqual(clearedIntervals, [intervals[0]]);
    assert.equal(configReads, readsBeforeStop);
});

test("catalog refresh clears a timer created by a schedule invalidated during timer setup", async () => {
    let service;
    const clearedTimeouts = [];
    service = createService({
        config: {
            get: async () => ({ data: { tle_auto_update_enabled: true, tle_auto_update_hours: 12 } })
        },
        setTimeoutImpl: () => {
            service.stop();
            return "late-catalog-refresh-delay";
        },
        clearTimeoutImpl: (timer) => { clearedTimeouts.push(timer); }
    });

    await service.schedule();

    assert.deepEqual(clearedTimeouts, ["late-catalog-refresh-delay"]);
});

test("catalog refresh clears an interval created after stop during interval setup", async () => {
    let service;
    let initialCallback;
    const clearedIntervals = [];
    service = createService({
        config: {
            get: async () => ({ data: { tle_auto_update_enabled: true, tle_auto_update_hours: 12 } })
        },
        setTimeoutImpl: (callback) => {
            initialCallback = callback;
            return "catalog-refresh-delay";
        },
        setIntervalImpl: () => {
            service.stop();
            return "late-catalog-refresh-interval";
        },
        clearIntervalImpl: (timer) => { clearedIntervals.push(timer); }
    });

    await service.schedule();
    initialCallback();

    assert.deepEqual(clearedIntervals, ["late-catalog-refresh-interval"]);
});

test("catalog refresh stop invalidates a schedule that is still loading configuration", async () => {
    let resolveConfig;
    const scheduled = [];
    const service = createService({
        config: {
            get: () => new Promise((resolve) => { resolveConfig = resolve; })
        },
        setTimeoutImpl: (callback, delay) => {
            scheduled.push({ callback, delay });
            return scheduled.at(-1);
        },
        clearTimeoutImpl: () => {}
    });

    const scheduling = service.schedule();
    service.stop();
    resolveConfig({ data: { tle_auto_update_enabled: true, tle_auto_update_hours: 12 } });
    await scheduling;

    assert.deepEqual(scheduled, []);
});

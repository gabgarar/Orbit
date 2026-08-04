import { filterValidTleEntries, getCatalogEntryOrigin, normalizeTleEntries } from "./tle.js";
import { withCatalogMetadata } from "./metadata.js";
import { DEFAULT_CATALOG_SOURCES, DEFAULT_CELESTRAK_GROUPS, discoverCelestrakGroups, downloadCatalogSource, normalizeCatalogSources } from "./remote.js";
import { CATALOG_REFRESH_LAST_ATTEMPT_KEY } from "../config/data-keys.js";
import { getUniqueSorted, runWithConcurrency } from "../shared/collections.js";

const MIN_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_AUTO_REFRESH_HOURS = 12;
// Node clamps timer delays above this value to one millisecond. Keep the
// configured cadence within that limit so a very large, but finite, value
// cannot turn into an immediate refresh loop.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
const DOWNLOAD_CONCURRENCY = 1;
export { CATALOG_REFRESH_LAST_ATTEMPT_KEY, MAX_TIMER_DELAY_MS };

function groupSource(group) {
    return {
        name: group,
        group,
        format: "TLE",
        url: `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`
    };
}

function sourceProvider(source) {
    try {
        const hostname = new URL(String(source?.url || "")).hostname.toLowerCase();
        if (hostname.endsWith("celestrak.org")) return "CelesTrak";
        if (hostname.endsWith("space-track.org")) return "Space-Track";
        return hostname;
    } catch {
        return "";
    }
}

function refreshTimestamp(value) {
    const timestamp = Number(value);
    const date = Number.isFinite(timestamp) ? new Date(timestamp) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function stampRemoteEntries(entries, source, updatedAt) {
    const provider = sourceProvider(source);
    const sourceName = String(source?.name || "").trim();
    return (Array.isArray(entries) ? entries : []).map((entry) => ({
        ...entry,
        sourceOrigin: "CATALOG",
        ...(provider ? { tleSource: provider, sourceProvider: provider } : {}),
        ...(sourceName ? { sourceName } : {}),
        ...(updatedAt ? { updatedAt } : {})
    }));
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function recordedAttemptAt(data) {
    const timestamp = Number(data?.[CATALOG_REFRESH_LAST_ATTEMPT_KEY]);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function resolveAutoRefreshIntervalMs(value, fallbackHours = DEFAULT_AUTO_REFRESH_HOURS) {
    const requestedHours = Number(value);
    const requestedFallbackHours = Number(fallbackHours);
    const validFallbackHours = Number.isFinite(requestedFallbackHours) && requestedFallbackHours > 0
        ? requestedFallbackHours
        : DEFAULT_AUTO_REFRESH_HOURS;
    const validHours = Number.isFinite(requestedHours) && requestedHours > 0
        ? requestedHours
        : validFallbackHours;
    const requestedIntervalMs = validHours * 60 * 60 * 1000;
    const safeIntervalMs = Number.isFinite(requestedIntervalMs)
        ? requestedIntervalMs
        : MAX_TIMER_DELAY_MS;
    return Math.min(MAX_TIMER_DELAY_MS, Math.max(MIN_REFRESH_INTERVAL_MS, safeIntervalMs));
}

export function createCatalogRefreshService({
    catalog,
    config,
    serialize,
    reloadPython,
    logger = console,
    download = downloadCatalogSource,
    discoverGroups = discoverCelestrakGroups,
    defaultGroups = DEFAULT_CELESTRAK_GROUPS,
    defaultSources = DEFAULT_CATALOG_SOURCES,
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
}) {
    let activeRefresh = null;
    let refreshGeneration = 0;
    let refreshesAllowed = true;
    let lastAttemptAt = 0;
    let intervalTimer = null;
    let initialTimer = null;
    let scheduleGeneration = 0;

    async function mergeIntoLatestCatalog(mutator, replacementVersion) {
        if (Number.isSafeInteger(replacementVersion) && typeof catalog.updateUnlessReplaced === "function") {
            return catalog.updateUnlessReplaced(replacementVersion, mutator, serialize);
        }
        if (typeof catalog.update === "function") return catalog.update(mutator, serialize);
        const current = await catalog.get();
        const entries = await mutator(current);
        if (entries === undefined) return { ...current, changed: false };
        const catalogPath = await catalog.replace(entries, serialize);
        return { catalogPath, entries, changed: true };
    }

    function latestAttemptAt(settings) {
        return Math.max(lastAttemptAt, recordedAttemptAt(settings?.data));
    }

    async function persistAttempt(settings, attemptedAt) {
        const withAttemptTimestamp = (currentSettings) => {
            const currentData = currentSettings?.data && typeof currentSettings.data === "object" && !Array.isArray(currentSettings.data)
                ? currentSettings.data
                : {};
            return {
                ...currentSettings,
                data: { ...currentData, [CATALOG_REFRESH_LAST_ATTEMPT_KEY]: attemptedAt }
            };
        };
        if (typeof config.save !== "function" && typeof config.update !== "function") return;
        try {
            if (typeof config.update === "function") {
                await config.update(withAttemptTimestamp);
            } else {
                await config.save(withAttemptTimestamp(settings));
            }
        } catch (error) {
            logger.warn("Unable to persist catalog refresh timestamp:", errorMessage(error));
        }
    }

    function runAutomaticRefresh() {
        refresh().then((result) => {
            if (!result.ok && !result.rateLimited && !result.superseded && !result.cancelled) logger.warn("Automatic catalog refresh failed:", result.error);
        }).catch((error) => logger.warn("Automatic catalog refresh failed:", errorMessage(error)));
    }

    function clearScheduledRefresh() {
        if (initialTimer !== null) clearTimeoutImpl(initialTimer);
        if (intervalTimer !== null) clearIntervalImpl(intervalTimer);
        initialTimer = null;
        intervalTimer = null;
    }

    function cancelledRefreshResult() {
        return {
            ok: false,
            status: 409,
            cancelled: true,
            error: "El refresco de catalogo se detuvo antes de completarse."
        };
    }

    async function refresh({ discover = false } = {}) {
        if (!refreshesAllowed) return cancelledRefreshResult();
        if (activeRefresh) return { ok: false, status: 409, error: "Ya hay una actualizacion de catalogo en curso." };
        const generation = refreshGeneration;
        const controller = new AbortController();
        const wasStopped = () => generation !== refreshGeneration || controller.signal.aborted;
        const active = { controller, promise: null };
        activeRefresh = active;

        const operation = (async () => {
        // Capture this before the first await. A replacement import started
        // after this refresh must win over remote downloads that finish later.
            const supportsReplacementGuard = typeof catalog.getReplacementVersion === "function"
                && typeof catalog.updateUnlessReplaced === "function";
            const replacementVersion = supportsReplacementGuard
                ? catalog.getReplacementVersion()
                : null;
            const settings = await config.get();
            if (wasStopped()) return cancelledRefreshResult();
            if (settings.data?.offline_mode === true) return { ok: false, status: 409, error: "Modo offline activo: refresco remoto de catalogo deshabilitado." };

            const previousAttemptAt = latestAttemptAt(settings);
            const elapsedMs = previousAttemptAt ? Math.max(0, now() - previousAttemptAt) : 0;
            const remainingMs = MIN_REFRESH_INTERVAL_MS - elapsedMs;
            if (previousAttemptAt && remainingMs > 0) {
                return {
                    ok: false,
                    status: 429,
                    rateLimited: true,
                    retryAfterMs: remainingMs,
                    retryAt: refreshTimestamp(previousAttemptAt + MIN_REFRESH_INTERVAL_MS),
                    error: `CelesTrak recomienda actualizar como maximo cada 2 horas. Reintenta dentro de ${Math.ceil(remainingMs / 60_000)} minutos.`
                };
            }

            lastAttemptAt = now();
            await persistAttempt(settings, lastAttemptAt);
            if (wasStopped()) return cancelledRefreshResult();

            let discoveredGroups = [];
            let discoveryError = null;
            const downloadOptions = { signal: controller.signal };
            if (discover) {
                try {
                    discoveredGroups = await discoverGroups(downloadOptions);
                } catch (error) {
                    if (wasStopped()) return cancelledRefreshResult();
                    discoveryError = errorMessage(error);
                }
            }
            if (wasStopped()) return cancelledRefreshResult();

            const groups = getUniqueSorted([...defaultGroups, ...discoveredGroups]);
            const sources = normalizeCatalogSources([...defaultSources, ...(Array.isArray(settings.data?.catalog_sources) ? settings.data.catalog_sources : [])]);
            const successfulGroups = [];
            const failedGroups = [];
            const successfulSources = [];
            const failedSources = [];

            await runWithConcurrency(groups, DOWNLOAD_CONCURRENCY, async (group) => {
                if (wasStopped()) return;
                try {
                    const source = groupSource(group);
                    const result = await download(source, downloadOptions);
                    if (wasStopped()) return;
                    successfulGroups.push({ group, source, count: result.entries.length, entries: result.entries });
                } catch (error) {
                    if (!wasStopped()) failedGroups.push({ group, message: errorMessage(error) });
                }
            });
            await runWithConcurrency(sources, DOWNLOAD_CONCURRENCY, async (source) => {
                if (wasStopped()) return;
                try {
                    const result = await download(source, downloadOptions);
                    if (wasStopped()) return;
                    successfulSources.push({ ...result, source });
                } catch (error) {
                    if (!wasStopped()) failedSources.push({ source: source.name, url: source.url, message: errorMessage(error) });
                }
            });
            if (wasStopped()) return cancelledRefreshResult();

            const updatedAt = refreshTimestamp(lastAttemptAt);
            const remoteEntries = successfulGroups.flatMap((result) => stampRemoteEntries(result.entries, result.source, updatedAt))
                .concat(successfulSources.flatMap((result) => stampRemoteEntries(result.entries, result.source, updatedAt)));
            const { valid: validRemoteEntries, invalid: invalidRemoteEntries } = filterValidTleEntries(remoteEntries.map(withCatalogMetadata));
            if (!validRemoteEntries.length) {
                return {
                    ok: false,
                    status: 502,
                    error: "No se pudo descargar ningun TLE valido desde CelesTrak.",
                    failed: failedGroups,
                    failedSources,
                    discardedInvalidEntries: invalidRemoteEntries.length
                };
            }
            const preservePreviousCatalogEntries = failedGroups.length > 0 || failedSources.length > 0;
            let customEntries = [];
            let retainedCatalogEntries = [];
            let merged = [];
            let valid = [];
            let invalid = [];
            let normalized = [];
            const persisted = await mergeIntoLatestCatalog(({ entries: currentEntries }) => {
                if (wasStopped()) return undefined;
                customEntries = currentEntries.filter((entry) => getCatalogEntryOrigin(entry) === "CUSTOM");
                retainedCatalogEntries = preservePreviousCatalogEntries
                    ? currentEntries.filter((entry) => getCatalogEntryOrigin(entry) !== "CUSTOM")
                    : [];
                merged = [...remoteEntries, ...retainedCatalogEntries, ...customEntries].map(withCatalogMetadata);
                ({ valid, invalid } = filterValidTleEntries(merged));
                normalized = normalizeTleEntries(valid);
                return normalized.length ? normalized : undefined;
            }, replacementVersion);
            if (wasStopped()) return cancelledRefreshResult();
            if (persisted.superseded) {
                return {
                    ok: false,
                    status: 409,
                    superseded: true,
                    error: "La actualizacion remota se descarto porque se importo un catalogo de reemplazo mientras se descargaba."
                };
            }
            if (!normalized.length) {
                return { ok: false, status: 502, error: "No se pudo descargar ningun TLE valido desde CelesTrak.", failed: failedGroups, failedSources, discardedInvalidEntries: invalid.length };
            }

            const result = {
                ok: true,
                attemptedGroups: groups.length,
                downloadedEntries: remoteEntries.length,
                validEntries: valid.length,
                discardedInvalidEntries: invalid.length,
                writtenEntries: persisted.entries.length,
                preservedCustomEntries: customEntries.length,
                preservedCatalogEntries: retainedCatalogEntries.length,
                successfulGroups: successfulGroups.map(({ group, count }) => ({ group, count })),
                failedGroups,
                successfulSources: successfulSources.map(({ name, format, entries, skipped }) => ({ name, format, count: entries.length, skipped: Number(skipped) || 0 })),
                failedSources,
                discoveredGroups: discoveredGroups.length,
                discoveryError
            };
            if (wasStopped()) return cancelledRefreshResult();
            const runtimeApplied = await reloadPython({ signal: controller.signal });
            if (wasStopped()) return cancelledRefreshResult();
            if (runtimeApplied === false) {
                return {
                    ...result,
                    ok: false,
                    status: 503,
                    persisted: true,
                    error: "El catalogo se guardo, pero el backend de propagacion no pudo recargarse. Reinicia Orbit para aplicar los cambios."
                };
            }
            return result;
        })();
        active.promise = operation;
        try {
            return await operation;
        } finally {
            if (activeRefresh === active) activeRefresh = null;
        }
    }

    async function schedule() {
        refreshesAllowed = true;
        const generation = ++scheduleGeneration;
        clearScheduledRefresh();
        const settings = await config.get();
        if (generation !== scheduleGeneration) return;
        const data = settings.data || {};
        if (data.tle_auto_update_enabled !== true) return;
        const intervalMs = resolveAutoRefreshIntervalMs(data.tle_auto_update_hours);
        const previousAttemptAt = latestAttemptAt(settings);
        const elapsedMs = previousAttemptAt ? Math.max(0, now() - previousAttemptAt) : 0;
        const initialDelayMs = previousAttemptAt ? Math.max(0, intervalMs - elapsedMs) : intervalMs;
        const timer = setTimeoutImpl(() => {
            if (generation !== scheduleGeneration) return;
            initialTimer = null;
            runAutomaticRefresh();
            if (generation !== scheduleGeneration) return;
            const nextIntervalTimer = setIntervalImpl(() => {
                if (generation === scheduleGeneration) runAutomaticRefresh();
            }, intervalMs);
            // Test doubles and alternative timer implementations can invoke
            // stop() while creating this timer. Do not retain a timer that was
            // created by an invalidated schedule generation.
            if (generation !== scheduleGeneration) {
                clearIntervalImpl(nextIntervalTimer);
                return;
            }
            intervalTimer = nextIntervalTimer;
        }, initialDelayMs);
        if (generation !== scheduleGeneration) {
            clearTimeoutImpl(timer);
            return;
        }
        initialTimer = timer;
    }

    function stop() {
        refreshesAllowed = false;
        scheduleGeneration += 1;
        refreshGeneration += 1;
        clearScheduledRefresh();
        const active = activeRefresh;
        active?.controller.abort();
        return active?.promise
            ? active.promise.catch((error) => logger.warn("Unable to stop catalog refresh cleanly:", errorMessage(error)))
            : Promise.resolve();
    }

    return { refresh, schedule, stop };
}

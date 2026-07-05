// server/nodeServer.js
import express from "express";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 8100;
const CONFIG_DIR = path.join(__dirname, "../config");
const SYSTEM_CONFIG_PATH = path.join(CONFIG_DIR, "system_config.json");
const DEFAULT_CATALOG_FILE = "catalog.json";
const PYTHON_BACKEND_URL = "http://127.0.0.1:8765";
const AUTO_UPDATE_DEFAULT_HOURS = 12;
const DECAY_ALERT_DEFAULT_PERIGEE_KM = 200;
const AUTO_UPDATE_MIN_HOURS = 0.25;
const REMOTE_FETCH_TIMEOUT_MS = 30000;
const REMOTE_FETCH_CONCURRENCY = 4;
const REMOTE_CONNECTIVITY_CHECK_TIMEOUT_MS = 8000;
const CELESTRAK_CONNECTIVITY_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";

const DEFAULT_CELESTRAK_GROUPS = [
    // Grupos de mayor cobertura
    "active",
    "starlink",
    "oneweb",
    "geo",
    "gnss",
    "visual",
    "planet",
    "cubesat",

    // Grupos temáticos
    "weather",
    "resource",
    "sarsat",
    "stations",
    "science",
    "education",
    "intelsat",
    "iridium",
    "orbcomm",
    "globalstar",
    "tle-new",
    "military",
    "radar",
    "galileo",
    "goes",
    "noaa",
    "dmc",
    "geodetic",
    "engineering",
    "sbas",
    "ses",
    "amateur",
    "x-comm"
];

const DEFAULT_CATALOG_SOURCES = [
    {
        name: "stations-omm-xml",
        format: "OMM_XML",
        url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=xml"
    },
    {
        name: "iss-oem",
        format: "OEM",
        url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=oem"
    }
];

const EARTH_RADIUS_KM = 6378.137;
const EARTH_MU_KM3_S2 = 398600.4418;
const ORBIT_KIND = {
    LEO: "leo",
    MEO: "meo",
    GEO: "geo",
    HEO: "heo",
    UNKNOWN: "unknown"
};

const MISSION_RULES = [
    { value: "starlink", test: /\bstarlink\b/i },
    { value: "sentinel", test: /\bsentinel\b/i },
    { value: "oneweb", test: /\boneweb\b/i },
    { value: "planet", test: /\bplanet\b/i },
    { value: "gnss", test: /\b(gps|galileo|glonass|beidou|navstar|qzss|irnss|navic)\b/i },
    { value: "weather", test: /\b(weather|goes|noaa|meteo|metop|himawari|fy-|fengyun)\b/i },
    { value: "communications", test: /\b(intelsat|iridium|orbcomm|globalstar|ses|viasat|echostar)\b/i },
    { value: "stations", test: /\b(iss|tiangong|css|station)\b/i },
    { value: "military", test: /\b(nrol|yaogan|military|defense|usa )\b/i },
    { value: "science", test: /\b(hubble|jwst|fermi|swift|gaia|tess|science)\b/i },
    { value: "earth-observation", test: /\b(landsat|resource|dmc|radarsat|spot|pleiades)\b/i }
];

let catalogCache = {
    path: "",
    mtimeMs: 0,
    entries: []
};

let pythonProcess = null;
let ownsPythonBackendProcess = false;
let catalogAutoUpdateTimer = null;

function getUniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean).map((v) => String(v).trim().toLowerCase()))).sort();
}

app.use(express.json({ limit: "25mb" }));

async function fetchWithTimeout(url, options = {}, timeoutMs = REMOTE_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function runWithConcurrency(items, limit, worker) {
    const queue = Array.isArray(items) ? items.slice() : [];
    const workers = [];
    const maxWorkers = Math.max(1, Math.min(Number(limit) || 1, queue.length || 1));

    for (let i = 0; i < maxWorkers; i += 1) {
        workers.push((async () => {
            while (queue.length) {
                const item = queue.shift();
                await worker(item);
            }
        })());
    }

    await Promise.all(workers);
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonOrDefault(filePath, fallbackValue) {
    try {
        const raw = await fs.readFile(filePath, "utf-8");
        return JSON.parse(raw);
    } catch {
        return fallbackValue;
    }
}

async function getSystemConfigPayload() {
    const payload = await readJsonOrDefault(SYSTEM_CONFIG_PATH, {
        system: {},
        data: { satellites_catalog_file: DEFAULT_CATALOG_FILE }
    });
    if (!isObject(payload)) {
        return {
            system: {},
            data: { satellites_catalog_file: DEFAULT_CATALOG_FILE }
        };
    }
    return {
        ...payload,
        system: isObject(payload.system) ? payload.system : {},
        data: isObject(payload.data) ? payload.data : { satellites_catalog_file: DEFAULT_CATALOG_FILE }
    };
}

async function writeSystemConfigPayload(payload) {
    await fs.writeFile(SYSTEM_CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

async function isOfflineModeEnabled() {
    const payload = await getSystemConfigPayload();
    return payload?.data?.offline_mode === true;
}

function toProxyHeaders(req) {
    const headers = {
        Accept: req.headers.accept || "application/json"
    };
    const contentType = req.headers["content-type"];
    if (contentType) {
        headers["Content-Type"] = contentType;
    }
    return headers;
}

async function proxyToPython(req, res, pythonPath, { method = req.method, body = undefined } = {}) {
    try {
        const target = new URL(pythonPath, `${PYTHON_BACKEND_URL}/`);
        if (req.query && Object.keys(req.query).length) {
            for (const [key, value] of Object.entries(req.query)) {
                if (Array.isArray(value)) {
                    for (const v of value) {
                        target.searchParams.append(key, String(v));
                    }
                } else if (value !== undefined && value !== null) {
                    target.searchParams.set(key, String(value));
                }
            }
        }

        const payload = body === undefined
            ? (req.method === "GET" || req.method === "HEAD" ? undefined : req.body)
            : body;

        const response = await fetch(target, {
            method,
            headers: toProxyHeaders(req),
            body: payload === undefined ? undefined : JSON.stringify(payload)
        });

        const contentType = response.headers.get("content-type") || "application/json";
        const text = await response.text();
        res.status(response.status);
        res.set("Content-Type", contentType);
        res.send(text);
    } catch (error) {
        res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function sanitizeSystemConfigPayload(payload) {
    if (!isObject(payload)) {
        return null;
    }

    const system = payload.system;
    if (!isObject(system)) {
        return null;
    }

    // Mantener solamente estructura esperada del sistema.
    return {
        system,
        data: isObject(payload.data) ? payload.data : undefined
    };
}

function parseTleCatalog(text) {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const entries = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i] || "";
        const line1 = lines[i + 1] || "";
        const line2 = lines[i + 2] || "";
        if (!name || !line1.startsWith("1 ") || !line2.startsWith("2 ")) {
            continue;
        }
        entries.push({ name, line1, line2, sourceFormat: "TLE" });
    }

    return entries;
}

function inferOperator(name) {
    const raw = String(name || "").trim();
    if (!raw) return "unknown";
    if (/\bstarlink\b/i.test(raw)) return "spacex";
    if (/\boneweb\b/i.test(raw)) return "oneweb";
    if (/\bgalileo\b/i.test(raw)) return "esa";
    if (/\bgps|navstar\b/i.test(raw)) return "ussf";
    if (/\bglonass\b/i.test(raw)) return "roscosmos";
    if (/\bbeidou\b/i.test(raw)) return "casc";
    if (/\biss|station|tiangong\b/i.test(raw)) return "multinational";
    if (/\biridium\b/i.test(raw)) return "iridium";
    if (/\bglobalstar\b/i.test(raw)) return "globalstar";
    if (/\bintelsat\b/i.test(raw)) return "intelsat";
    return "unknown";
}

function inferOwner(name) {
    const operator = inferOperator(name);
    if (operator === "spacex") return "spacex";
    if (operator === "oneweb") return "eutelsat-oneweb";
    if (operator === "esa") return "esa";
    if (operator === "ussf") return "us-space-force";
    if (operator === "roscosmos") return "roscosmos";
    if (operator === "casc") return "china";
    if (operator === "iridium") return "iridium";
    if (operator === "globalstar") return "globalstar";
    if (operator === "intelsat") return "intelsat";
    return "unknown";
}

function estimatePerigeeKmFromLine2(line2) {
    const clean = String(line2 || "");
    const meanMotion = Number(clean.slice(52, 63).trim());
    const eccRaw = clean.slice(26, 33).trim();
    const eccentricity = Number(`0.${eccRaw || "0"}`);
    if (!Number.isFinite(meanMotion) || meanMotion <= 0) {
        return null;
    }
    if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
        return null;
    }
    const nRadSec = meanMotion * (2 * Math.PI) / 86400;
    const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (nRadSec * nRadSec));
    const perigeeKm = (semiMajorAxisKm * (1 - eccentricity)) - EARTH_RADIUS_KM;
    return Number.isFinite(perigeeKm) ? perigeeKm : null;
}

function withCatalogMetadata(entry = {}) {
    const name = String(entry?.name || "").trim();
    const line1 = String(entry?.line1 || "").trim();
    const line2 = String(entry?.line2 || "").trim();
    const sourceFormat = String(entry?.sourceFormat || "TLE").toUpperCase();
    const sourceOriginRaw = String(entry?.sourceOrigin || entry?.source_origin || "CATALOG").trim().toUpperCase();
    const sourceOrigin = sourceOriginRaw === "CUSTOM" ? "CUSTOM" : "CATALOG";
    const operator = String(entry?.operator || inferOperator(name)).trim().toLowerCase();
    const owner = String(entry?.owner || inferOwner(name)).trim().toLowerCase();
    const perigeeKm = Number.isFinite(Number(entry?.perigee_km))
        ? Number(entry.perigee_km)
        : estimatePerigeeKmFromLine2(line2);

    return {
        ...entry,
        name,
        line1,
        line2,
        sourceFormat,
        sourceOrigin,
        operator,
        owner,
        perigee_km: Number.isFinite(perigeeKm) ? perigeeKm : null
    };
}

function parseOmmJsonCatalog(text) {
    const payload = JSON.parse(String(text || "{}"));
    const rows = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.entries) ? payload.entries : (Array.isArray(payload?.omm) ? payload.omm : []));

    const entries = [];
    let skipped = 0;

    for (const row of rows) {
        const name = String(row?.name || row?.OBJECT_NAME || row?.OBJECT_ID || "").trim();
        const line1 = String(row?.line1 || row?.line_1 || row?.TLE_LINE1 || "").trim();
        const line2 = String(row?.line2 || row?.line_2 || row?.TLE_LINE2 || "").trim();
        if (!name || !line1 || !line2) {
            skipped += 1;
            continue;
        }
        entries.push(withCatalogMetadata({
            name,
            line1,
            line2,
            sourceFormat: "OMM",
            operator: row?.operator || row?.OPERATOR || row?.OWNER || "",
            owner: row?.owner || row?.OWNER || ""
        }));
    }

    return { entries, skipped };
}

function parseSimpleXmlBlocks(text, tagName) {
    const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
    const blocks = [];
    let match = regex.exec(text);
    while (match) {
        blocks.push(match[1]);
        match = regex.exec(text);
    }
    return blocks;
}

function extractXmlTag(block, tag) {
    const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = rx.exec(block);
    return m ? String(m[1] || "").trim() : "";
}

function parseOmmXmlCatalog(text) {
    const xml = String(text || "");
    const blocks = [
        ...parseSimpleXmlBlocks(xml, "segment"),
        ...parseSimpleXmlBlocks(xml, "omm")
    ];

    const entries = [];
    let skipped = 0;

    for (const block of blocks) {
        const name = extractXmlTag(block, "OBJECT_NAME") || extractXmlTag(block, "OBJECT_ID");
        const line1 = extractXmlTag(block, "TLE_LINE1") || extractXmlTag(block, "line1");
        const line2 = extractXmlTag(block, "TLE_LINE2") || extractXmlTag(block, "line2");
        if (!name || !line1 || !line2) {
            skipped += 1;
            continue;
        }
        entries.push(withCatalogMetadata({ name, line1, line2, sourceFormat: "OMM" }));
    }

    return { entries, skipped };
}

function parseOemCatalog(text, fileName = "") {
    const content = String(text || "");
    const nameFromMeta = /OBJECT_NAME\s*=\s*(.+)/i.exec(content)?.[1]?.trim() || path.parse(fileName).name || "OEM Imported";
    const l1 = /TLE_LINE1\s*=\s*(1\s.+)/i.exec(content)?.[1]?.trim() || "";
    const l2 = /TLE_LINE2\s*=\s*(2\s.+)/i.exec(content)?.[1]?.trim() || "";
    if (!l1 || !l2) {
        return { entries: [], skipped: 1 };
    }
    return {
        entries: [withCatalogMetadata({ name: nameFromMeta, line1: l1, line2: l2, sourceFormat: "OEM" })],
        skipped: 0
    };
}

function detectImportFormat(fileName, content) {
    const lowerName = String(fileName || "").toLowerCase();
    const trimmed = String(content || "").trim();
    if (lowerName.endsWith(".tle") || lowerName.endsWith(".txt")) {
        return "TLE";
    }
    if (lowerName.endsWith(".oem")) {
        return "OEM";
    }
    if (lowerName.endsWith(".omm")) {
        return "OMM";
    }
    if (lowerName.endsWith(".xml")) {
        if (/<oem|<ephemeris/i.test(trimmed)) return "OEM";
        return "OMM_XML";
    }
    if (lowerName.endsWith(".json")) {
        return "OMM_JSON";
    }
    if (trimmed.startsWith("{" ) || trimmed.startsWith("[")) {
        return "OMM_JSON";
    }
    if (trimmed.startsWith("<")) {
        return /<oem|<ephemeris/i.test(trimmed) ? "OEM" : "OMM_XML";
    }
    return "TLE";
}

function normalizeCatalogSources(rawSources) {
    const customList = Array.isArray(rawSources) ? rawSources : [];
    const list = [...DEFAULT_CATALOG_SOURCES, ...customList];
    const normalized = [];

    for (const item of list) {
        if (!isObject(item)) {
            continue;
        }

        const url = String(item.url || "").trim();
        if (!url) {
            continue;
        }

        const name = String(item.name || url).trim();
        const format = String(item.format || "").trim().toUpperCase();
        normalized.push({ name, url, format });
    }

    const dedup = new Map();
    for (const source of normalized) {
        dedup.set(`${source.format}|${source.url}`, source);
    }
    return Array.from(dedup.values());
}

function parseSourceEntriesByFormat(format, content, sourceName) {
    const normalizedFormat = String(format || "").trim().toUpperCase();
    if (normalizedFormat === "TLE") {
        const entries = parseTleCatalog(content).map((entry) => withCatalogMetadata({ ...entry, sourceFormat: "TLE" }));
        return { entries, skipped: 0, format: "TLE" };
    }
    if (normalizedFormat === "OMM_JSON") {
        const parsed = parseOmmJsonCatalog(content);
        return { entries: parsed.entries, skipped: parsed.skipped, format: "OMM_JSON" };
    }
    if (normalizedFormat === "OMM_XML" || normalizedFormat === "OMM") {
        const parsed = parseOmmXmlCatalog(content);
        return { entries: parsed.entries, skipped: parsed.skipped, format: "OMM_XML" };
    }
    if (normalizedFormat === "OEM") {
        const parsed = parseOemCatalog(content, sourceName);
        return { entries: parsed.entries, skipped: parsed.skipped, format: "OEM" };
    }

    const inferred = detectImportFormat(sourceName, content);
    return parseSourceEntriesByFormat(inferred, content, sourceName);
}

async function downloadCatalogSource(source) {
    const url = String(source?.url || "").trim();
    if (!url) {
        throw new Error("Fuente sin URL.");
    }

    const sourceName = String(source?.name || url).trim();
    const response = await fetchWithTimeout(url, {
        headers: {
            Accept: "*/*",
            "User-Agent": "Orbit-Catalog-Updater/1.0"
        },
        cache: "no-store"
    }, REMOTE_FETCH_TIMEOUT_MS);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const content = await response.text();
    const parsed = parseSourceEntriesByFormat(source?.format, content, sourceName);
    return {
        name: sourceName,
        url,
        format: parsed.format,
        count: parsed.entries.length,
        skipped: Number(parsed.skipped) || 0,
        entries: parsed.entries
    };
}

async function performCatalogRefreshWithGroups(groups = DEFAULT_CELESTRAK_GROUPS, sources = []) {
    const successful = [];
    const failed = [];
    const sourceSuccessful = [];
    const sourceFailed = [];

    await runWithConcurrency(groups, REMOTE_FETCH_CONCURRENCY, async (group) => {
        try {
            const result = await downloadGroup(group);
            successful.push(result);
        } catch (error) {
            failed.push({
                group,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });

    const normalizedSources = normalizeCatalogSources(sources);
    await runWithConcurrency(normalizedSources, REMOTE_FETCH_CONCURRENCY, async (source) => {
        try {
            const result = await downloadCatalogSource(source);
            sourceSuccessful.push(result);
        } catch (error) {
            sourceFailed.push({
                source: source.name || source.url,
                url: source.url,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });

    const { entries: currentEntries } = await getCatalogEntriesCached();
    const preservedCustomEntries = currentEntries.filter((entry) => String(entry?.sourceOrigin || "CATALOG").toUpperCase() === "CUSTOM");

    const merged = successful
        .flatMap((item) => item.entries)
        .concat(sourceSuccessful.flatMap((item) => item.entries))
        .concat(preservedCustomEntries)
        .map((entry) => withCatalogMetadata(entry));
    const { valid, invalid } = filterValidTleEntries(merged);
    const normalized = normalizeEntries(valid);

    if (!normalized.length) {
        const firstGroupError = failed[0]?.message || "";
        const firstSourceError = sourceFailed[0]?.message || "";
        const errorSuffix = firstGroupError || firstSourceError
            ? ` Primer error remoto: ${firstGroupError || firstSourceError}`
            : "";
        return {
            ok: false,
            error: `No se pudo descargar ningun TLE valido desde CelesTrak.${errorSuffix}`,
            failed,
            failedSources: sourceFailed,
            discardedInvalidEntries: invalid.length
        };
    }

    const catalogPath = await resolveCatalogPath();
    const ext = path.extname(catalogPath).toLowerCase();
    const catalogPayload = ext === ".txt"
        ? serializeCatalog(normalized)
        : serializeCatalogJson(normalized);

    await fs.writeFile(catalogPath, catalogPayload, "utf-8");
    catalogCache = { path: "", mtimeMs: 0, entries: [] };

    return {
        ok: true,
        catalogFile: path.basename(catalogPath),
        attemptedGroups: groups.length,
        downloadedEntries: merged.length,
        validEntries: valid.length,
        discardedInvalidEntries: invalid.length,
        writtenEntries: normalized.length,
        preservedCustomEntries: preservedCustomEntries.length,
        successfulGroups: successful.map((item) => ({ group: item.group, count: item.count })),
        failedGroups: failed,
        successfulSources: sourceSuccessful.map((item) => ({
            name: item.name,
            format: item.format,
            count: item.count,
            skipped: item.skipped
        })),
        failedSources: sourceFailed
    };
}

function clearAutoCatalogUpdateTimer() {
    if (catalogAutoUpdateTimer) {
        clearInterval(catalogAutoUpdateTimer);
        catalogAutoUpdateTimer = null;
    }
}

async function scheduleAutoCatalogRefreshFromConfig() {
    clearAutoCatalogUpdateTimer();
    const cfg = await getSystemConfigPayload();
    const data = isObject(cfg?.data) ? cfg.data : {};
    const enabled = data.tle_auto_update_enabled === true;
    if (!enabled) {
        return;
    }

    const intervalHoursRaw = Number(data.tle_auto_update_hours);
    const intervalHours = Number.isFinite(intervalHoursRaw) && intervalHoursRaw >= AUTO_UPDATE_MIN_HOURS
        ? intervalHoursRaw
        : AUTO_UPDATE_DEFAULT_HOURS;

    const groups = Array.isArray(data.tle_auto_update_groups) && data.tle_auto_update_groups.length
        ? getUniqueSorted(data.tle_auto_update_groups)
        : DEFAULT_CELESTRAK_GROUPS;

    catalogAutoUpdateTimer = setInterval(async () => {
        try {
            if (await isOfflineModeEnabled()) {
                return;
            }
            await performCatalogRefreshWithGroups(groups, data.catalog_sources);
            await reloadPythonBackend();
        } catch (error) {
            console.warn("Actualizacion automatica de TLE fallida:", error);
        }
    }, Math.max(60_000, intervalHours * 3600 * 1000));
}

async function isPythonBackendHealthy() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    try {
        const response = await fetch(`${PYTHON_BACKEND_URL}/health`, {
            signal: controller.signal,
            headers: { Accept: "application/json" }
        });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function reloadPythonBackend() {
    if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill("SIGHUP");
        return true;
    }

    if (!(await isPythonBackendHealthy())) {
        return false;
    }

    try {
        const response = await fetch(`${PYTHON_BACKEND_URL}/reload`, {
            method: "POST",
            headers: { Accept: "application/json" }
        });
        return response.ok;
    } catch {
        return false;
    }
}

function stopOwnedPythonBackend(signalName = "SIGTERM") {
    if (!ownsPythonBackendProcess || !pythonProcess || pythonProcess.killed) {
        return;
    }

    try {
        pythonProcess.kill(signalName);
    } catch (error) {
        console.warn("No se pudo detener el backend Python:", error);
    }
}

async function ensurePythonBackend() {
    if (await isPythonBackendHealthy()) {
        console.log("[SERVER] Backend Python ya activo en puerto 8765. Se reutiliza el proceso existente.");
        ownsPythonBackendProcess = false;
        pythonProcess = null;
        return;
    }

    console.log("🚀 Arrancando servidor Python SGP4...");
    pythonProcess = spawn("python3", ["server.py"], {
        cwd: path.join(__dirname, "./python")
    });
    ownsPythonBackendProcess = true;

    pythonProcess.stdout.on("data", (data) => {
        console.log("[SERVER]", data.toString());
    });

    pythonProcess.stderr.on("data", (data) => {
        console.log("[SERVER]", data.toString());
    });

    pythonProcess.on("close", (code) => {
        ownsPythonBackendProcess = false;
        pythonProcess = null;
        console.log(`⚠️ Python terminó con código ${code}`);
    });
}

function computeTleChecksum(line) {
    if (typeof line !== "string" || line.length < 69) {
        return null;
    }

    let sum = 0;
    for (let i = 0; i < 68; i += 1) {
        const ch = line[i];
        if (ch >= "0" && ch <= "9") {
            sum += Number(ch);
        } else if (ch === "-") {
            sum += 1;
        }
    }

    return sum % 10;
}

function hasValidTleChecksum(line) {
    if (typeof line !== "string" || line.length < 69) {
        return false;
    }

    const expected = Number(line[68]);
    if (!Number.isInteger(expected) || expected < 0 || expected > 9) {
        return false;
    }

    const actual = computeTleChecksum(line);
    return actual === expected;
}

function isValidTleEntry(entry) {
    const name = String(entry?.name || "").trim();
    const line1 = String(entry?.line1 || "").trim();
    const line2 = String(entry?.line2 || "").trim();

    if (!name || !line1.startsWith("1 ") || !line2.startsWith("2 ")) {
        return false;
    }

    if (line1.length < 69 || line2.length < 69) {
        return false;
    }

    const sat1 = line1.slice(2, 7);
    const sat2 = line2.slice(2, 7);
    if (!/^\d{5}$/.test(sat1) || sat1 !== sat2) {
        return false;
    }

    if (!hasValidTleChecksum(line1) || !hasValidTleChecksum(line2)) {
        return false;
    }

    const meanMotionRaw = line2.slice(52, 63).trim();
    const meanMotion = Number(meanMotionRaw);
    if (!Number.isFinite(meanMotion) || meanMotion <= 0) {
        return false;
    }

    return true;
}

function filterValidTleEntries(entries) {
    const valid = [];
    const invalid = [];

    for (const entry of entries) {
        if (isValidTleEntry(entry)) {
            valid.push(entry);
        } else {
            invalid.push(entry);
        }
    }

    return { valid, invalid };
}

function normalizeEntries(entries) {
    const bySatNumber = new Map();

    for (const entry of entries) {
        const satNumber = entry.line1.slice(2, 7).trim();
        const fallbackKey = `${entry.name}|${entry.line1}|${entry.line2}`;
        const key = satNumber || fallbackKey;
        if (!bySatNumber.has(key)) {
            bySatNumber.set(key, entry);
        }
    }

    return Array.from(bySatNumber.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function serializeCatalog(entries) {
    return entries.map((entry) => `${entry.name}\n${entry.line1}\n${entry.line2}`).join("\n\n") + "\n";
}

function serializeCatalogJson(entries) {
    return JSON.stringify({
        format: "tle-catalog-v1",
        generatedAt: new Date().toISOString(),
        count: entries.length,
        entries
    });
}

function normalizeCatalogEntries(rawEntries) {
    return Array.isArray(rawEntries)
        ? rawEntries
            .map((entry) => withCatalogMetadata({
                ...entry,
                name: String(entry?.name || "").trim(),
                line1: String(entry?.line1 || "").trim(),
                line2: String(entry?.line2 || "").trim(),
                sourceFormat: entry?.sourceFormat || entry?.format || "TLE"
            }))
            .filter((entry) => entry.name && entry.line1 && entry.line2)
        : [];
}

async function readCatalogEntries(catalogPath) {
    const ext = path.extname(catalogPath).toLowerCase();
    const raw = await fs.readFile(catalogPath, "utf-8");

    if (ext === ".json") {
        const payload = JSON.parse(raw);
        const entries = Array.isArray(payload) ? payload : payload?.entries;
        return normalizeCatalogEntries(entries);
    }

    return normalizeCatalogEntries(parseTleCatalog(raw));
}

async function getCatalogEntriesCached() {
    const catalogPath = await resolveCatalogPath();
    const stats = await fs.stat(catalogPath);

    if (
        catalogCache.path === catalogPath &&
        catalogCache.mtimeMs === stats.mtimeMs &&
        Array.isArray(catalogCache.entries)
    ) {
        return { catalogPath, entries: catalogCache.entries };
    }

    const entries = await readCatalogEntries(catalogPath);
    catalogCache = {
        path: catalogPath,
        mtimeMs: stats.mtimeMs,
        entries
    };

    return { catalogPath, entries };
}

function estimateAltitudeKmFromLine2(line2) {
    const meanMotion = Number(String(line2 || "").slice(52, 63).trim());
    if (!Number.isFinite(meanMotion) || meanMotion <= 0) {
        return null;
    }

    const nRadSec = meanMotion * (2 * Math.PI) / 86400;
    const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (nRadSec * nRadSec));
    const altitudeKm = semiMajorAxisKm - EARTH_RADIUS_KM;
    return Number.isFinite(altitudeKm) ? altitudeKm : null;
}

function inferOrbitKind(line2) {
    const altitudeKm = estimateAltitudeKmFromLine2(line2);
    if (!Number.isFinite(altitudeKm)) {
        return ORBIT_KIND.UNKNOWN;
    }
    if (altitudeKm < 2000) return ORBIT_KIND.LEO;
    if (altitudeKm < 35786) return ORBIT_KIND.MEO;
    if (altitudeKm >= 35000 && altitudeKm <= 36550) return ORBIT_KIND.GEO;
    if (altitudeKm > 35786) return ORBIT_KIND.HEO;
    return ORBIT_KIND.UNKNOWN;
}

function inferMission(name) {
    const normalized = String(name || "").trim();
    for (const rule of MISSION_RULES) {
        if (rule.test.test(normalized)) {
            return rule.value;
        }
    }
    return "other";
}

function normalizePaginationNumber(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
}

function normalizeFilterParam(value) {
    return String(value || "").trim().toLowerCase();
}

function getNoradIdFromEntry(entry) {
    const raw = String(entry?.line1 || "").slice(2, 7).trim();
    return /^\d+$/.test(raw) ? raw : "";
}

function filterCatalogEntries(entries, { search, orbitKind, mission, operator, owner, decayOnly, decayPerigeeKm }) {
    const hasSearch = Boolean(search);
    const hasOrbitFilter = Boolean(orbitKind);
    const hasMissionFilter = Boolean(mission);
    const hasOperatorFilter = Boolean(operator);
    const hasOwnerFilter = Boolean(owner);
    const hasDecayOnly = decayOnly === true;
    const decayThreshold = Number.isFinite(Number(decayPerigeeKm)) ? Number(decayPerigeeKm) : DECAY_ALERT_DEFAULT_PERIGEE_KM;

    if (!hasSearch && !hasOrbitFilter && !hasMissionFilter && !hasOperatorFilter && !hasOwnerFilter && !hasDecayOnly) {
        return entries;
    }

    return entries.filter((entry) => {
        if (hasSearch) {
            const nameMatch = entry.name.toLowerCase().includes(search);
            const noradId = getNoradIdFromEntry(entry);
            const normalizedSearch = String(search || "").replace(/^0+/, "");
            const noradMatch = noradId
                ? noradId.includes(search) || (normalizedSearch && noradId.includes(normalizedSearch))
                : false;

            if (!nameMatch && !noradMatch) {
                return false;
            }
        }
        if (hasOrbitFilter && inferOrbitKind(entry.line2) !== orbitKind) {
            return false;
        }
        if (hasMissionFilter && inferMission(entry.name) !== mission) {
            return false;
        }
        if (hasOperatorFilter) {
            const op = String(entry?.operator || inferOperator(entry?.name || "")).toLowerCase();
            if (op !== operator) return false;
        }
        if (hasOwnerFilter) {
            const own = String(entry?.owner || inferOwner(entry?.name || "")).toLowerCase();
            if (own !== owner) return false;
        }
        if (hasDecayOnly) {
            const perigeeKm = Number.isFinite(Number(entry?.perigee_km))
                ? Number(entry.perigee_km)
                : estimatePerigeeKmFromLine2(entry?.line2 || "");
            if (!Number.isFinite(perigeeKm) || perigeeKm >= decayThreshold) {
                return false;
            }
        }
        return true;
    });
}

function normalizeSourceFormat(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "TLE" || normalized === "OMM" || normalized === "OEM" || normalized === "OCM") {
        return normalized;
    }
    return "";
}

function normalizeSourceOrigin(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "CUSTOM" || normalized === "CATALOG") {
        return normalized;
    }
    return "";
}

function formatCatalogEntryToTleText(entry) {
    return `${entry.name}\n${entry.line1}\n${entry.line2}\n`;
}

function formatCatalogEntryToOmmJson(entry) {
    return JSON.stringify({
        OBJECT_NAME: entry.name,
        OBJECT_ID: entry.name,
        TLE_LINE1: entry.line1,
        TLE_LINE2: entry.line2,
        NORAD_CAT_ID: getNoradIdFromEntry(entry),
        SOURCE_FORMAT: entry.sourceFormat || "TLE"
    }, null, 2);
}

function formatCatalogEntryToOmmXml(entry) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<ndm>\n  <omm version="2.0">\n    <body>\n      <segment>\n        <metadata>\n          <OBJECT_NAME>${entry.name}</OBJECT_NAME>\n          <OBJECT_ID>${entry.name}</OBJECT_ID>\n        </metadata>\n        <data>\n          <tleParameters>\n            <TLE_LINE1>${entry.line1}</TLE_LINE1>\n            <TLE_LINE2>${entry.line2}</TLE_LINE2>\n            <NORAD_CAT_ID>${getNoradIdFromEntry(entry)}</NORAD_CAT_ID>\n          </tleParameters>\n        </data>\n      </segment>\n    </body>\n  </omm>\n</ndm>\n`;
}

function formatCatalogEntryToOcm(entry) {
    return JSON.stringify({
        format: "OCM",
        object: {
            name: entry.name,
            norad_id: getNoradIdFromEntry(entry),
            source_format: entry.sourceFormat || "TLE"
        },
        mean_elements_source: {
            line1: entry.line1,
            line2: entry.line2
        },
        generatedAt: new Date().toISOString()
    }, null, 2);
}

function formatCatalogEntryToOem(entry, propagator = "sgp4") {
    const sourceFormat = String(entry?.sourceFormat || "TLE").toUpperCase();
    const name = String(entry?.name || "UNKNOWN").trim();
    const line1 = String(entry?.line1 || "").trim();
    const line2 = String(entry?.line2 || "").trim();
    return [
        "CCSDS_OEM_VERS = 2.0",
        `CREATION_DATE = ${new Date().toISOString()}`,
        "ORIGINATOR = Orbit",
        `COMMENT = SOURCE_FORMAT ${sourceFormat}`,
        `COMMENT = PROPAGATOR ${String(propagator || "sgp4").trim().toLowerCase()}`,
        "META_START",
        `OBJECT_NAME = ${name}`,
        `OBJECT_ID = ${name}`,
        "CENTER_NAME = EARTH",
        "REF_FRAME = TEME",
        "TIME_SYSTEM = UTC",
        "META_STOP",
        `COMMENT = TLE_LINE1 ${line1}`,
        `COMMENT = TLE_LINE2 ${line2}`,
        ""
    ].join("\n");
}

function isEntrySourceFormat(entry, expected) {
    return String(entry?.sourceFormat || "TLE").trim().toUpperCase() === String(expected || "").trim().toUpperCase();
}

async function resolveCatalogPath() {
    try {
        const raw = await fs.readFile(SYSTEM_CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        const dataCfg = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
        const configuredFile = dataCfg.satellites_catalog_file || DEFAULT_CATALOG_FILE;
        const safeFileName = path.basename(String(configuredFile));
        return path.join(CONFIG_DIR, safeFileName);
    } catch {
        return path.join(CONFIG_DIR, DEFAULT_CATALOG_FILE);
    }
}

async function downloadGroup(group) {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
    const response = await fetchWithTimeout(url, {
        headers: {
            Accept: "text/plain",
            "User-Agent": "Orbit-Catalog-Updater/1.0"
        },
        cache: "no-store"
    }, REMOTE_FETCH_TIMEOUT_MS);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const entries = parseTleCatalog(text);
    return {
        group,
        url,
        count: entries.length,
        entries
    };
}

async function discoverCelestrakGroups() {
    const response = await fetchWithTimeout("https://celestrak.org/NORAD/elements/", {
        headers: {
            Accept: "text/html",
            "User-Agent": "Orbit-Catalog-Updater/1.0"
        },
        cache: "no-store"
    }, REMOTE_FETCH_TIMEOUT_MS);

    if (!response.ok) {
        throw new Error(`No se pudo descubrir grupos: HTTP ${response.status}`);
    }

    const html = await response.text();
    const matches = html.match(/GROUP=([A-Za-z0-9\-]+)/g) || [];
    const groups = matches
        .map((m) => m.replace("GROUP=", "").toLowerCase())
        .filter((g) => g.length > 0);

    return getUniqueSorted(groups);
}

app.post("/api/catalog/refresh", async (req, res) => {
    if (await isOfflineModeEnabled()) {
        res.status(409).json({
            ok: false,
            error: "Modo offline activo: refresco remoto de catalogo deshabilitado."
        });
        return;
    }

    const discoverRequested = String(req.query?.discover || "").toLowerCase() === "true";
    let discoveredGroups = [];
    let discoveryError = null;
    if (discoverRequested) {
        try {
            discoveredGroups = await discoverCelestrakGroups();
        } catch (error) {
            discoveryError = error instanceof Error ? error.message : String(error);
        }
    }

    const groupsToDownload = discoveredGroups.length
        ? getUniqueSorted([...DEFAULT_CELESTRAK_GROUPS, ...discoveredGroups])
        : DEFAULT_CELESTRAK_GROUPS;

    // Pre-check: verificar conectividad con CelesTrak antes de lanzar todas las descargas
    try {
        const connectCheck = await fetchWithTimeout(
            CELESTRAK_CONNECTIVITY_URL,
            { headers: { Accept: "text/plain", "User-Agent": "Orbit-Catalog-Updater/1.0" }, cache: "no-store" },
            REMOTE_CONNECTIVITY_CHECK_TIMEOUT_MS
        );
        if (!connectCheck.ok) {
            throw new Error(`HTTP ${connectCheck.status}`);
        }
    } catch (connError) {
        const isTimeout = connError?.name === "AbortError" || String(connError?.message || "").includes("timeout") || String(connError?.message || "").includes("abort");
        const reason = isTimeout ? "timeout de conexion" : String(connError?.message || "error de red");
        res.status(502).json({
            ok: false,
            networkBlocked: true,
            error: `No se puede conectar con CelesTrak desde esta red (${reason}). Si usas un entorno cloud (Codespace, cloud IDE, etc.), es posible que celestrak.org bloquee esas IPs. Importa los TLE/OMM manualmente desde el catalogo.`,
            failed: [],
            failedSources: []
        });
        return;
    }

    const cfg = await getSystemConfigPayload();
    const data = isObject(cfg?.data) ? cfg.data : {};
    const result = await performCatalogRefreshWithGroups(groupsToDownload, data.catalog_sources);
    if (!result.ok) {
        res.status(502).json(result);
        return;
    }

    await reloadPythonBackend();
    res.json({
        ...result,
        discoveredGroups: discoveredGroups.length,
        discoveryError
    });
});

app.post("/api/catalog/import", async (req, res) => {
    try {
        const fileName = String(req.body?.fileName || "imported-catalog").trim();
        const content = String(req.body?.content || "");
        const merge = req.body?.merge !== false;
        if (!content.trim()) {
            res.status(400).json({ ok: false, error: "Contenido de fichero vacio." });
            return;
        }

        const format = detectImportFormat(fileName, content);
        let parsed = { entries: [], skipped: 0 };

        if (format === "TLE") {
            parsed.entries = parseTleCatalog(content).map((entry) => withCatalogMetadata({ ...entry, sourceFormat: "TLE" }));
        } else if (format === "OMM_JSON") {
            parsed = parseOmmJsonCatalog(content);
        } else if (format === "OMM_XML") {
            parsed = parseOmmXmlCatalog(content);
        } else if (format === "OEM") {
            parsed = parseOemCatalog(content, fileName);
        }

        const markedEntries = parsed.entries.map((entry) => withCatalogMetadata({ ...entry, sourceOrigin: "CUSTOM" }));
        if (format === "OEM" && markedEntries.length === 0) {
            res.status(400).json({
                ok: false,
                error: "El OEM no contiene TLE embebido (TLE_LINE1/TLE_LINE2). OEM ephemeris puro aun no se importa como orbita nativa."
            });
            return;
        }

        const { valid, invalid } = filterValidTleEntries(markedEntries);
        const { entries: currentEntries } = await getCatalogEntriesCached();

        const existingByNorad = new Map();
        for (const entry of currentEntries) {
            const norad = getNoradIdFromEntry(entry);
            if (!norad || existingByNorad.has(norad)) {
                continue;
            }
            existingByNorad.set(norad, String(entry?.name || "").trim());
        }

        const renamedConflicts = [];
        for (const entry of valid) {
            const norad = getNoradIdFromEntry(entry);
            if (!norad) {
                continue;
            }
            const existingName = String(existingByNorad.get(norad) || "").trim();
            const importedName = String(entry?.name || "").trim();
            if (!existingName || !importedName) {
                continue;
            }
            if (existingName.toLowerCase() === importedName.toLowerCase()) {
                continue;
            }
            renamedConflicts.push({ norad, existingName, importedName });
        }

        const mergedSource = merge ? [...currentEntries, ...valid] : valid;
        const normalized = normalizeEntries(mergedSource.map((entry) => withCatalogMetadata(entry)));
        if (!normalized.length) {
            res.status(400).json({ ok: false, error: "No se encontraron elementos validos para importar." });
            return;
        }

        const catalogPath = await resolveCatalogPath();
        const ext = path.extname(catalogPath).toLowerCase();
        const payload = ext === ".txt" ? serializeCatalog(normalized) : serializeCatalogJson(normalized);
        await fs.writeFile(catalogPath, payload, "utf-8");
        catalogCache = { path: "", mtimeMs: 0, entries: [] };

        await reloadPythonBackend();
        const importedNames = getUniqueSorted(valid.map((entry) => String(entry?.name || "").trim()).filter(Boolean));
        res.json({
            ok: true,
            format,
            imported: valid.length,
            importedNames,
            renamedConflicts,
            invalid: invalid.length,
            skipped: Number(parsed.skipped || 0),
            total: normalized.length,
            merge
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/catalog/page", async (req, res) => {
    try {
        const offset = normalizePaginationNumber(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = normalizePaginationNumber(req.query.limit, 100, 1, 1000);
        const search = normalizeFilterParam(req.query.search);
        const orbitKind = normalizeFilterParam(req.query.orbitKind);
        const mission = normalizeFilterParam(req.query.mission);
        const sourceFormat = normalizeSourceFormat(req.query.sourceFormat);
        const sourceOrigin = normalizeSourceOrigin(req.query.sourceOrigin);
        const operator = normalizeFilterParam(req.query.operator);
        const owner = normalizeFilterParam(req.query.owner);
        const decayOnly = String(req.query.decayOnly || "").toLowerCase() === "true";

        const systemPayload = await getSystemConfigPayload();
        const decayPerigeeKm = Number(systemPayload?.data?.decay_alert_perigee_km ?? DECAY_ALERT_DEFAULT_PERIGEE_KM);

        const { entries } = await getCatalogEntriesCached();
        const filteredBase = filterCatalogEntries(entries, { search, orbitKind, mission, operator, owner, decayOnly, decayPerigeeKm });
        const filtered = sourceFormat
            ? filteredBase.filter((entry) => String(entry?.sourceFormat || "TLE").toUpperCase() === sourceFormat)
            : filteredBase;
        const filteredByOrigin = sourceOrigin
            ? filtered.filter((entry) => String(entry?.sourceOrigin || "CATALOG").toUpperCase() === sourceOrigin)
            : filtered;

        const allOperators = getUniqueSorted(entries.map((entry) => entry.operator || inferOperator(entry.name)));
        const allOwners = getUniqueSorted(entries.map((entry) => entry.owner || inferOwner(entry.name)));

        const pageItems = filteredByOrigin
            .slice(offset, offset + limit)
            .map((entry) => ({
                ...entry,
                noradId: getNoradIdFromEntry(entry),
                decayRisk: Number.isFinite(Number(entry?.perigee_km)) && Number(entry.perigee_km) < decayPerigeeKm
            }));

        res.json({
            ok: true,
            total: filteredByOrigin.length,
            offset,
            limit,
            hasMore: offset + pageItems.length < filteredByOrigin.length,
            operators: allOperators,
            owners: allOwners,
            decayPerigeeKm,
            items: pageItems
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

app.get("/api/catalog/tle", async (req, res) => {
    try {
        const queryName = String(req.query.name || "").trim();
        if (!queryName) {
            res.status(400).json({ ok: false, error: "Parametro 'name' requerido." });
            return;
        }

        const target = queryName.toLowerCase();
        const { entries } = await getCatalogEntriesCached();
        const match = entries.find((entry) => entry.name.toLowerCase() === target);

        if (!match) {
            res.status(404).json({ ok: false, error: "Satelite no encontrado." });
            return;
        }

        res.json({ ok: true, item: match });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

app.get("/api/export/tle/:satId", async (req, res) => {
    try {
        const satId = String(req.params.satId || "").trim().toLowerCase();
        const { entries } = await getCatalogEntriesCached();
        const entry = entries.find((item) => String(item?.name || "").trim().toLowerCase() === satId);
        if (!entry) {
            res.status(404).json({ ok: false, error: "Satelite no encontrado." });
            return;
        }
        if (!isEntrySourceFormat(entry, "TLE")) {
            res.status(400).json({ ok: false, error: "Este satelite no tiene origen TLE. Exporta en su formato de origen." });
            return;
        }

        const fileBase = String(entry.name || "satellite").replace(/[^a-z0-9\-_]+/gi, "_");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.tle"`);
        res.send(formatCatalogEntryToTleText(entry));
    } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/export/omm/:satId", async (req, res) => {
    try {
        const satId = String(req.params.satId || "").trim().toLowerCase();
        const format = String(req.query.format || "json").trim().toLowerCase();
        const { entries } = await getCatalogEntriesCached();
        const entry = entries.find((item) => String(item?.name || "").trim().toLowerCase() === satId);
        if (!entry) {
            res.status(404).json({ ok: false, error: "Satelite no encontrado." });
            return;
        }
        if (!isEntrySourceFormat(entry, "OMM")) {
            res.status(400).json({ ok: false, error: "Este satelite no tiene origen OMM. Exporta en su formato de origen." });
            return;
        }

        const fileBase = String(entry.name || "satellite").replace(/[^a-z0-9\-_]+/gi, "_");
        if (format === "xml") {
            res.setHeader("Content-Type", "application/xml; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.omm.xml"`);
            res.send(formatCatalogEntryToOmmXml(entry));
            return;
        }

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.omm.json"`);
        res.send(formatCatalogEntryToOmmJson(entry));
    } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/export/oem/:satId", async (req, res) => {
    try {
        const satId = String(req.params.satId || "").trim().toLowerCase();
        const propagator = String(req.query.propagator || "sgp4").trim().toLowerCase();
        const { entries } = await getCatalogEntriesCached();
        const entry = entries.find((item) => String(item?.name || "").trim().toLowerCase() === satId);
        if (!entry) {
            res.status(404).json({ ok: false, error: "Satelite no encontrado." });
            return;
        }
        if (!isEntrySourceFormat(entry, "OEM")) {
            res.status(400).json({ ok: false, error: "Este satelite no tiene origen OEM. Exporta en su formato de origen." });
            return;
        }

        const fileBase = String(entry.name || "satellite").replace(/[^a-z0-9\-_]+/gi, "_");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.oem"`);
        res.send(formatCatalogEntryToOem(entry, propagator));
    } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/export/ocm/:satId", async (req, res) => {
    try {
        const satId = String(req.params.satId || "").trim().toLowerCase();
        const { entries } = await getCatalogEntriesCached();
        const entry = entries.find((item) => String(item?.name || "").trim().toLowerCase() === satId);
        if (!entry) {
            res.status(404).json({ ok: false, error: "Satelite no encontrado." });
            return;
        }

        const fileBase = String(entry.name || "satellite").replace(/[^a-z0-9\-_]+/gi, "_");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.ocm.json"`);
        res.send(formatCatalogEntryToOcm(entry));
    } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/api/export/ephemeris/:satId", async (req, res) => {
    await proxyToPython(req, res, `/export/ephemeris/${encodeURIComponent(req.params.satId)}`);
});

app.post("/api/system-config", async (req, res) => {
    try {
        const sanitized = sanitizeSystemConfigPayload(req.body);
        if (!sanitized) {
            res.status(400).json({
                ok: false,
                error: "Payload inválido. Se esperaba { system: {...}, data?: {...} }."
            });
            return;
        }

        const previous = await getSystemConfigPayload();

        const nextConfig = {
            ...previous,
            system: sanitized.system,
            data: sanitized.data ?? previous?.data ?? { satellites_catalog_file: DEFAULT_CATALOG_FILE }
        };

        await writeSystemConfigPayload(nextConfig);
        await scheduleAutoCatalogRefreshFromConfig();

        // Forzar recarga inmediata de configuración en backend Python.
        try {
            const reloaded = await reloadPythonBackend();
            if (!reloaded) {
                console.warn("No se pudo recargar el backend Python tras guardar configuracion.");
            }
        } catch (signalError) {
            console.warn("No se pudo recargar el backend Python:", signalError);
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

app.get("/docs*", async (req, res) => {
    const suffix = String(req.path || "").replace(/^\/docs/, "") || "";
    const pythonPath = `/docs${suffix}`;
    await proxyToPython(req, res, pythonPath);
});

app.get("/openapi.json", async (req, res) => {
    await proxyToPython(req, res, "/openapi.json");
});

app.get("/redoc", async (req, res) => {
    await proxyToPython(req, res, "/redoc");
});

app.get("/api/propagate/:satId", async (req, res) => {
    await proxyToPython(req, res, `/propagate/${encodeURIComponent(req.params.satId)}`);
});

app.get("/api/orbits/:satId", async (req, res) => {
    await proxyToPython(req, res, `/orbits/${encodeURIComponent(req.params.satId)}`);
});

app.post("/api/propagate", async (req, res) => {
    await proxyToPython(req, res, "/propagate");
});

app.post("/api/orbits", async (req, res) => {
    await proxyToPython(req, res, "/orbits");
});

app.get("/api/aos-los", async (req, res) => {
    await proxyToPython(req, res, "/aos-los");
});

app.post("/api/aos-los", async (req, res) => {
    await proxyToPython(req, res, "/aos-los");
});

app.post("/api/ephemeris", async (req, res) => {
    await proxyToPython(req, res, "/ephemeris");
});

// ===============================
// 1) Servir carpeta pública y configuración JSON
// ===============================
app.use(express.static(path.join(__dirname, "../public")));
app.use("/config", express.static(CONFIG_DIR));

app.listen(PORT, () => {
    console.log(`🌍 Servidor web en http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
    stopOwnedPythonBackend("SIGINT");
    process.exit(0);
});

process.on("SIGTERM", () => {
    stopOwnedPythonBackend("SIGTERM");
    process.exit(0);
});

process.on("exit", () => {
    stopOwnedPythonBackend("SIGTERM");
});

await ensurePythonBackend();
await scheduleAutoCatalogRefreshFromConfig();

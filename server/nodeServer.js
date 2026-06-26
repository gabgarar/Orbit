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

function getUniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean).map((v) => String(v).trim().toLowerCase()))).sort();
}

app.use(express.json());

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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
        entries.push({ name, line1, line2 });
    }

    return entries;
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
            .map((entry) => ({
                name: String(entry?.name || "").trim(),
                line1: String(entry?.line1 || "").trim(),
                line2: String(entry?.line2 || "").trim()
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

function filterCatalogEntries(entries, { search, orbitKind, mission }) {
    const hasSearch = Boolean(search);
    const hasOrbitFilter = Boolean(orbitKind);
    const hasMissionFilter = Boolean(mission);

    if (!hasSearch && !hasOrbitFilter && !hasMissionFilter) {
        return entries;
    }

    return entries.filter((entry) => {
        if (hasSearch && !entry.name.toLowerCase().includes(search)) {
            return false;
        }
        if (hasOrbitFilter && inferOrbitKind(entry.line2) !== orbitKind) {
            return false;
        }
        if (hasMissionFilter && inferMission(entry.name) !== mission) {
            return false;
        }
        return true;
    });
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
    const response = await fetch(url, {
        headers: {
            Accept: "text/plain",
            "User-Agent": "Orbit-Catalog-Updater/1.0"
        },
        cache: "no-store"
    });

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
    const response = await fetch("https://celestrak.org/NORAD/elements/", {
        headers: {
            Accept: "text/html",
            "User-Agent": "Orbit-Catalog-Updater/1.0"
        },
        cache: "no-store"
    });

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

app.post("/api/catalog/refresh", async (_req, res) => {
    const successful = [];
    const failed = [];

    let discoveredGroups = [];
    let discoveryError = null;
    try {
        discoveredGroups = await discoverCelestrakGroups();
    } catch (error) {
        discoveryError = error instanceof Error ? error.message : String(error);
    }

    const groupsToDownload = discoveredGroups.length
        ? getUniqueSorted([...DEFAULT_CELESTRAK_GROUPS, ...discoveredGroups])
        : DEFAULT_CELESTRAK_GROUPS;

    for (const group of groupsToDownload) {
        try {
            const result = await downloadGroup(group);
            successful.push(result);
        } catch (error) {
            failed.push({
                group,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    const merged = successful.flatMap((item) => item.entries);
    const { valid, invalid } = filterValidTleEntries(merged);
    const normalized = normalizeEntries(valid);

    if (!normalized.length) {
        res.status(502).json({
            ok: false,
            error: "No se pudo descargar ningun TLE valido desde CelesTrak.",
            failed,
            discardedInvalidEntries: invalid.length
        });
        return;
    }

    const catalogPath = await resolveCatalogPath();
    const ext = path.extname(catalogPath).toLowerCase();
    const catalogPayload = ext === ".txt"
        ? serializeCatalog(normalized)
        : serializeCatalogJson(normalized);

    await fs.writeFile(catalogPath, catalogPayload, "utf-8");

    res.json({
        ok: true,
        catalogFile: path.basename(catalogPath),
        discoveredGroups: discoveredGroups.length,
        attemptedGroups: groupsToDownload.length,
        discoveryError,
        downloadedEntries: merged.length,
        validEntries: valid.length,
        discardedInvalidEntries: invalid.length,
        writtenEntries: normalized.length,
        successfulGroups: successful.map((item) => ({ group: item.group, count: item.count })),
        failedGroups: failed
    });
});

app.get("/api/catalog/page", async (req, res) => {
    try {
        const offset = normalizePaginationNumber(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = normalizePaginationNumber(req.query.limit, 100, 1, 1000);
        const search = normalizeFilterParam(req.query.search);
        const orbitKind = normalizeFilterParam(req.query.orbitKind);
        const mission = normalizeFilterParam(req.query.mission);

        const { entries } = await getCatalogEntriesCached();
        const filtered = filterCatalogEntries(entries, { search, orbitKind, mission });

        const pageItems = filtered.slice(offset, offset + limit);

        res.json({
            ok: true,
            total: filtered.length,
            offset,
            limit,
            hasMore: offset + pageItems.length < filtered.length,
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

        let previous = {};
        try {
            const raw = await fs.readFile(SYSTEM_CONFIG_PATH, "utf-8");
            previous = JSON.parse(raw);
        } catch {
            previous = {};
        }

        const nextConfig = {
            ...previous,
            system: sanitized.system,
            data: sanitized.data ?? previous?.data ?? { satellites_catalog_file: DEFAULT_CATALOG_FILE }
        };

        await fs.writeFile(SYSTEM_CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");

        // Forzar recarga inmediata de configuración en backend Python.
        try {
            if (pythonProcess && !pythonProcess.killed) {
                pythonProcess.kill("SIGHUP");
            }
        } catch (signalError) {
            console.warn("No se pudo enviar SIGHUP a Python:", signalError);
        }

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});

// ===============================
// 1) Servir carpeta pública y configuración JSON
// ===============================
app.use(express.static(path.join(__dirname, "../public")));
app.use("/config", express.static(CONFIG_DIR));

app.listen(PORT, () => {
    console.log(`🌍 Servidor web en http://localhost:${PORT}`);
});

// ===============================
// 2) Arrancar servidor Python
// ===============================
console.log("🚀 Arrancando servidor Python SGP4...");

const pythonProcess = spawn("python3", ["server.py"], {
    cwd: path.join(__dirname, "./python"),
});

pythonProcess.stdout.on("data", (data) => {
    console.log("[PYTHON]", data.toString());
});

pythonProcess.stderr.on("data", (data) => {
    console.error("[PYTHON ERROR]", data.toString());
});

pythonProcess.on("close", (code) => {
    console.log(`⚠️ Python terminó con código ${code}`);
});

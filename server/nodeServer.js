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

function getUniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean).map((v) => String(v).trim().toLowerCase()))).sort();
}

app.use(express.json());

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

async function resolveCatalogPath() {
    try {
        const raw = await fs.readFile(SYSTEM_CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        const dataCfg = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
        const configuredFile = dataCfg.satellites_catalog_file || dataCfg.satellites_file || DEFAULT_CATALOG_FILE;
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

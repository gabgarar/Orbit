import path from "node:path";
import { withCatalogMetadata } from "./metadata.js";

const SUPPORTED_FORMATS = new Set(["TLE", "OMM_JSON", "OMM_XML", "OEM"]);
const FORMAT_ALIASES = Object.freeze({ OMM: "OMM_XML" });
const XML_ENTITIES = Object.freeze({
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'"
});

function normalizedString(value) {
    return String(value || "").trim();
}

function canonicalFormat(format) {
    const normalized = normalizedString(format).toUpperCase();
    return FORMAT_ALIASES[normalized] || normalized;
}

function resolveCatalogFormat(format, fileName, content) {
    const requestedFormat = canonicalFormat(format);
    return SUPPORTED_FORMATS.has(requestedFormat)
        ? requestedFormat
        : canonicalFormat(detectImportFormat(fileName, content));
}

function getFirstValue(source, keys) {
    for (const key of keys) {
        const value = normalizedString(source?.[key]);
        if (value) return value;
    }
    return "";
}

function ommRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.entries)) return payload.entries;
    if (Array.isArray(payload?.omm)) return payload.omm;
    return [];
}

function xmlBlocks(text, tag) {
    const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    return Array.from(String(text || "").matchAll(expression), (match) => match[1]);
}

function decodeXmlEntities(value) {
    return String(value || "").replace(/&(amp|lt|gt|quot|apos);/gi, (_match, entity) => XML_ENTITIES[entity.toLowerCase()]);
}

function xmlTag(block, tag) {
    const expression = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
    return normalizedString(decodeXmlEntities(expression.exec(block)?.[1]));
}

export function parseTleCatalog(text) {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim());
    const entries = [];
    let pendingName = "";

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line || line.startsWith("#") || line.startsWith("//")) continue;
        if (!line.startsWith("1 ")) {
            if (!line.startsWith("2 ")) pendingName = line.replace(/^0\s+/, "").trim();
            continue;
        }

        let line2Index = index + 1;
        while (line2Index < lines.length && (!lines[line2Index] || lines[line2Index].startsWith("#") || lines[line2Index].startsWith("//"))) {
            line2Index += 1;
        }
        const line2 = lines[line2Index];
        if (!line2?.startsWith("2 ")) {
            pendingName = "";
            continue;
        }
        const noradId = line.slice(2, 7).trim();
        entries.push({
            name: pendingName || `NORAD ${noradId || "unknown"}`,
            line1: line,
            line2,
            sourceFormat: "TLE"
        });
        pendingName = "";
        index = line2Index;
    }
    return entries;
}

function parseOmmJsonCatalog(text) {
    const payload = JSON.parse(String(text || "{}"));
    const entries = [];
    let skipped = 0;

    for (const row of ommRows(payload)) {
        const name = getFirstValue(row, ["name", "OBJECT_NAME", "OBJECT_ID"]);
        const line1 = getFirstValue(row, ["line1", "line_1", "TLE_LINE1"]);
        const line2 = getFirstValue(row, ["line2", "line_2", "TLE_LINE2"]);
        if (!name || !line1 || !line2) {
            skipped += 1;
            continue;
        }
        entries.push(withCatalogMetadata({
            name,
            line1,
            line2,
            sourceFormat: "OMM",
            operator: getFirstValue(row, ["operator", "OPERATOR", "OWNER"]),
            owner: getFirstValue(row, ["owner", "OWNER"])
        }));
    }
    return { entries, skipped };
}

export function parseOmmXmlCatalog(text) {
    const segments = xmlBlocks(text, "segment");
    const blocks = segments.length ? segments : xmlBlocks(text, "omm");
    const entries = [];
    let skipped = 0;

    for (const block of blocks) {
        const name = xmlTag(block, "OBJECT_NAME") || xmlTag(block, "OBJECT_ID");
        const line1 = xmlTag(block, "TLE_LINE1") || xmlTag(block, "line1");
        const line2 = xmlTag(block, "TLE_LINE2") || xmlTag(block, "line2");
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
    const name = /OBJECT_NAME\s*=\s*(.+)/i.exec(content)?.[1]?.trim()
        || path.parse(fileName).name
        || "OEM Imported";
    const line1 = /TLE_LINE1\s*=\s*(1\s.+)/i.exec(content)?.[1]?.trim() || "";
    const line2 = /TLE_LINE2\s*=\s*(2\s.+)/i.exec(content)?.[1]?.trim() || "";

    if (!line1 || !line2) return { entries: [], skipped: 1 };
    return {
        entries: [withCatalogMetadata({ name, line1, line2, sourceFormat: "OEM" })],
        skipped: 0
    };
}

function detectImportFormat(fileName, content) {
    const name = String(fileName || "").toLowerCase();
    const trimmed = String(content || "").trim();
    const isOemXml = /<oem|<ephemeris/i.test(trimmed);

    if (name.endsWith(".tle") || name.endsWith(".txt")) return "TLE";
    if (name.endsWith(".oem")) return "OEM";
    if (name.endsWith(".omm")) return "OMM";
    if (name.endsWith(".xml")) return isOemXml ? "OEM" : "OMM_XML";
    if (name.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) return "OMM_JSON";
    return trimmed.startsWith("<") ? (isOemXml ? "OEM" : "OMM_XML") : "TLE";
}

/** Parse every supported catalog representation through one canonical format dispatcher. */
export function parseCatalogContent({ fileName = "", content = "", format } = {}) {
    const resolvedFormat = resolveCatalogFormat(format, fileName, content);
    if (resolvedFormat === "TLE") {
        return {
            format: "TLE",
            entries: parseTleCatalog(content).map((entry) => withCatalogMetadata({ ...entry, sourceFormat: "TLE" })),
            skipped: 0
        };
    }
    if (resolvedFormat === "OMM_JSON") return { format: "OMM_JSON", ...parseOmmJsonCatalog(content) };
    if (resolvedFormat === "OMM_XML") return { format: "OMM_XML", ...parseOmmXmlCatalog(content) };
    return { format: "OEM", ...parseOemCatalog(content, fileName) };
}

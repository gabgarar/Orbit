const DEFAULT_CATALOG_FILE = "catalog.json";

// This file holds the system configuration itself. A catalogue replacement
// must never be allowed to target it, even though it lives in the same volume.
const RESERVED_FILE_NAMES = new Set(["system_config.json"]);
const RESERVED_WINDOWS_FILE_STEMS = new Set([
    "con", "prn", "aux", "nul",
    ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);

function hasReservedWindowsFileStem(fileName) {
    return RESERVED_WINDOWS_FILE_STEMS.has(fileName.split(".", 1)[0].toLowerCase());
}

export function sanitizeCatalogFileName(value) {
    if (typeof value !== "string") return null;
    const fileName = value.trim();
    if (
        !fileName
        || fileName === "."
        || fileName === ".."
        || fileName.endsWith(".")
        || /[\\/\0-\x1F<>:"|?*]/.test(fileName)
    ) return null;
    if (RESERVED_FILE_NAMES.has(fileName.toLowerCase())) return null;
    if (hasReservedWindowsFileStem(fileName)) return null;
    return fileName;
}

export function normalizeCatalogFileName(value, fallback = DEFAULT_CATALOG_FILE) {
    const safeFallback = sanitizeCatalogFileName(fallback) || DEFAULT_CATALOG_FILE;
    return sanitizeCatalogFileName(value) || safeFallback;
}

import { sanitizeCatalogFileName } from "./catalog-file.js";

export { sanitizeCatalogFileName } from "./catalog-file.js";

export function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeDataPayload(data) {
    if (!isPlainObject(data)) return undefined;
    const sanitized = { ...data };
    if (!Object.hasOwn(sanitized, "satellites_catalog_file")) return sanitized;

    const catalogFileName = sanitizeCatalogFileName(sanitized.satellites_catalog_file);
    if (!catalogFileName) return null;
    sanitized.satellites_catalog_file = catalogFileName;
    return sanitized;
}

export function sanitizeSystemConfigPayload(payload) {
    if (!isPlainObject(payload) || !isPlainObject(payload.system)) return null;
    const data = sanitizeDataPayload(payload.data);
    if (data === null) return null;
    return { system: payload.system, data };
}

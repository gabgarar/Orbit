import { isPlainObject } from "./payload.js";

export const CATALOG_REFRESH_LAST_ATTEMPT_KEY = "catalog_last_refresh_attempt_at";
export const ACTIVE_CATALOG_FILE_KEY = "satellites_catalog_file";

const SERVER_MANAGED_DATA_KEYS = Object.freeze([
    CATALOG_REFRESH_LAST_ATTEMPT_KEY,
    ACTIVE_CATALOG_FILE_KEY
]);

/** Preserve operational fields that the browser is not allowed to replace. */
export function preserveServerManagedData(previousData, nextData) {
    const previous = isPlainObject(previousData) ? previousData : {};
    const next = isPlainObject(nextData) ? { ...nextData } : {};

    for (const key of SERVER_MANAGED_DATA_KEYS) {
        if (Object.hasOwn(previous, key)) {
            next[key] = previous[key];
        } else {
            delete next[key];
        }
    }
    return next;
}

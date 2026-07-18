import { parseCatalogContent } from "./parsers.js";
import { getUniqueSorted } from "../shared/collections.js";

export const DEFAULT_CELESTRAK_GROUPS = Object.freeze([
    "active", "starlink", "oneweb", "geo", "gnss", "visual", "planet", "cubesat",
    "weather", "resource", "sarsat", "stations", "science", "education", "intelsat",
    "iridium", "orbcomm", "globalstar", "tle-new", "military", "radar", "galileo",
    "goes", "noaa", "dmc", "geodetic", "engineering", "sbas", "ses", "amateur", "x-comm"
]);

export const DEFAULT_CATALOG_SOURCES = Object.freeze([
    Object.freeze({ name: "stations-omm-xml", format: "OMM_XML", url: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=xml" }),
    Object.freeze({ name: "iss-oem", format: "OEM", url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=oem" })
]);

const TRUSTED_CATALOG_HOSTS = new Set([
    "celestrak.org",
    "www.celestrak.org",
    "space-track.org",
    "www.space-track.org"
]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_CATALOG_REDIRECTS = 4;

function parseTrustedCatalogUrl(value, baseUrl) {
    try {
        const url = new URL(String(value || "").trim(), baseUrl);
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        if (
            url.protocol !== "https:"
            || url.username
            || url.password
            || !TRUSTED_CATALOG_HOSTS.has(hostname)
        ) {
            return null;
        }
        url.hash = "";
        return url;
    } catch {
        return null;
    }
}

/** Only allow the official HTTPS catalogue providers from persisted settings. */
export function normalizeCatalogSourceUrl(value) {
    return parseTrustedCatalogUrl(value)?.toString() || "";
}

export function normalizeCatalogSources(sources) {
    const deduplicated = new Map();
    for (const item of sources || []) {
        const url = normalizeCatalogSourceUrl(item?.url);
        if (!url) continue;
        const format = String(item?.format || "").trim().toUpperCase();
        deduplicated.set(`${format}|${url}`, { name: String(item?.name || url).trim(), format, url });
    }
    return [...deduplicated.values()];
}

export async function fetchTextWithTimeout(url, { timeoutMs = 30_000, fetchImpl = fetch, signal: externalSignal } = {}) {
    let targetUrl = normalizeCatalogSourceUrl(url);
    if (!targetUrl) throw new Error("Catalog source URL must use HTTPS from an approved provider.");
    const controller = new AbortController();
    const abortFromExternalSignal = () => controller.abort();
    if (externalSignal?.aborted) {
        controller.abort();
    } else {
        externalSignal?.addEventListener?.("abort", abortFromExternalSignal, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        for (let redirects = 0; redirects <= MAX_CATALOG_REDIRECTS; redirects += 1) {
            const response = await fetchImpl(targetUrl, {
                signal: controller.signal,
                headers: { Accept: "*/*", "User-Agent": "Orbit-Catalog-Updater/1.0" },
                cache: "no-store",
                redirect: "manual"
            });
            if (!REDIRECT_STATUS_CODES.has(response.status)) {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.text();
            }

            const redirectTarget = parseTrustedCatalogUrl(response.headers.get("location"), targetUrl);
            if (!redirectTarget) throw new Error("Catalog source redirected outside approved HTTPS providers.");
            targetUrl = redirectTarget.toString();
        }
        throw new Error("Catalog source exceeded the redirect limit.");
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
    }
}

export function parseCatalogSource(format, content, sourceName) {
    return parseCatalogContent({ format, content, fileName: sourceName });
}

export async function downloadCatalogSource(source, options) {
    const url = String(source?.url || "").trim();
    if (!url) throw new Error("Catalog source requires a URL.");
    const name = String(source?.name || url).trim();
    const content = await fetchTextWithTimeout(url, options);
    return { name, url, ...parseCatalogSource(source?.format, content, name) };
}

export async function discoverCelestrakGroups(options) {
    const html = await fetchTextWithTimeout("https://celestrak.org/NORAD/elements/", options);
    const matches = html.match(/GROUP=([A-Za-z0-9-]+)/g) || [];
    return getUniqueSorted(matches.map((match) => match.slice("GROUP=".length)));
}

/**
 * Normalize the non-persistent response returned by
 * `/api/precise-products/preview`.
 *
 * A provider may call the same GNSS satellite `satellite_id`, `gnss_id` or
 * simply `id`.  Keeping that tolerance here means the modal can stay a thin
 * presentation layer, while the import request always sends one stable list
 * of selected GNSS identifiers back to the Python service.
 */

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
    return String(value ?? "").trim();
}

function firstText(source, keys, fallback = "") {
    const value = record(source);
    if (!value) return fallback;
    for (const key of keys) {
        const candidate = text(value[key]);
        if (candidate) return candidate;
    }
    return fallback;
}

function firstValue(source, keys, fallback = null) {
    const value = record(source);
    if (!value) return fallback;
    for (const key of keys) {
        const candidate = value[key];
        if (candidate !== undefined && candidate !== null && candidate !== "") return candidate;
    }
    return fallback;
}

function satelliteList(payload, preview) {
    const sources = [preview, payload];
    for (const source of sources) {
        const candidate = record(source);
        if (!candidate) continue;
        for (const key of ["satellites", "detected_satellites", "detectedSatellites", "entries"]) {
            if (Array.isArray(candidate[key])) return candidate[key];
        }
    }
    return [];
}

function constellationFromSatelliteId(satelliteId) {
    const code = text(satelliteId).charAt(0).toUpperCase();
    return ({
        G: "GPS",
        R: "GLONASS",
        E: "Galileo",
        C: "BeiDou",
        J: "QZSS",
        I: "NavIC",
        S: "SBAS"
    })[code] || "GNSS";
}

function normalizeSampleCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeCadenceSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeSatellite(entry, product) {
    const satellite = record(entry);
    if (!satellite) return null;
    const satelliteCoverage = record(satellite.coverage) || {};
    const productCoverage = record(record(product)?.coverage) || {};
    const id = firstText(satellite, [
        "satellite_id", "satelliteId", "gnss_id", "gnssId", "prn", "id"
    ]);
    if (!id) return null;
    const constellation = firstText(satellite, [
        "constellation", "gnss_constellation", "gnssConstellation", "system"
    ], constellationFromSatelliteId(id));
    const name = firstText(satellite, [
        "display_name", "displayName", "satellite_name", "satelliteName", "name", "label"
    ], `${constellation} ${id}`);
    return {
        id,
        constellation,
        name,
        coverageStart: firstText(satellite, [
            "coverage_start", "coverageStart", "start_time", "startTime", "epoch_start", "epochStart"
        ], firstText(satelliteCoverage, ["start_time", "startTime", "coverage_start", "coverageStart"], firstText(product, [
            "coverage_start", "coverageStart", "start_time", "startTime"
        ], firstText(productCoverage, ["start_time", "startTime", "coverage_start", "coverageStart"])))),
        coverageEnd: firstText(satellite, [
            "coverage_end", "coverageEnd", "end_time", "endTime", "stop_time", "stopTime", "epoch_end", "epochEnd"
        ], firstText(satelliteCoverage, ["end_time", "endTime", "coverage_end", "coverageEnd"], firstText(product, [
            "coverage_end", "coverageEnd", "end_time", "endTime", "stop_time", "stopTime"
        ], firstText(productCoverage, ["end_time", "endTime", "coverage_end", "coverageEnd"])))),
        sampleCount: normalizeSampleCount(firstValue(satellite, [
            "sample_count", "sampleCount", "samples", "point_count", "pointCount"
        ], firstValue(product, ["sample_count", "sampleCount", "samples", "point_count", "pointCount"]))),
        cadenceSeconds: normalizeCadenceSeconds(firstValue(satellite, [
            "cadence_seconds", "cadenceSeconds", "sample_cadence_seconds", "sampleCadenceSeconds",
            "sampling_interval_seconds", "samplingIntervalSeconds",
            "interval_seconds", "intervalSeconds", "step_seconds", "stepSeconds"
        ], firstValue(product, [
            "cadence_seconds", "cadenceSeconds", "sample_cadence_seconds", "sampleCadenceSeconds",
            "sampling_interval_seconds", "samplingIntervalSeconds",
            "interval_seconds", "intervalSeconds", "step_seconds", "stepSeconds"
        ]))),
        raw: satellite
    };
}

/**
 * Return a predictable product preview even while the server evolves its
 * response envelope.  The caller must still treat this only as a preview:
 * no local layer or persistent product is created at this point.
 */
export function normalizePreciseProductPreview(payload = {}) {
    const root = record(payload) || {};
    const preview = record(root.preview) || root;
    const product = record(preview.product) || record(root.product) || null;
    const unique = new Map();
    for (const entry of satelliteList(root, preview)) {
        const normalized = normalizeSatellite(entry, product);
        if (normalized && !unique.has(normalized.id)) unique.set(normalized.id, normalized);
    }
    return {
        product,
        satellites: [...unique.values()]
    };
}

/** De-duplicate selected identifiers before an import request is sent. */
export function normalizeSelectedPreciseProductSatelliteIds(ids) {
    return [...new Set(Array.from(ids || [])
        .map((id) => text(id))
        .filter(Boolean))];
}

import { plannerIsoTimestamp } from "./plannerEvents.js";

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function firstValue(source, keys) {
    const candidate = record(source);
    for (const key of keys) {
        if (candidate[key] !== undefined && candidate[key] !== null && candidate[key] !== "") {
            return candidate[key];
        }
    }
    return undefined;
}

function iso(value) {
    return plannerIsoTimestamp(value);
}

function resourceId(prefix, value) {
    const suffix = text(value);
    return suffix ? `${prefix}:${suffix}` : "";
}

function uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });
}

function finiteCoverage({ id, resourceType, name, start, end, validation, metadata = {} }) {
    const normalizedId = text(id);
    const normalizedEnd = iso(end);
    if (!normalizedId || !normalizedEnd) return null;
    const normalizedStart = iso(start);
    return {
        id: normalizedId,
        resourceType,
        name: text(name) || normalizedId,
        ...(normalizedStart ? { validityStart: normalizedStart } : {}),
        // This explicit mapping is intentional. `buildPlannerResourceEvents`
        // never reads a raw coverage end, so a caller cannot accidentally turn
        // an intrinsic finite interval into an editorial expiry.
        validityEnd: normalizedEnd,
        validation: text(validation) || "verified-coverage",
        metadata: { ...metadata }
    };
}

function normalizeManualErp(reference) {
    const source = record(reference);
    const snapshotId = text(firstValue(source, ["snapshotId", "snapshot_id", "id"]));
    if (!snapshotId) return null;
    const coverageStart = iso(firstValue(source, ["coverageStart", "coverage_start", "startTime", "start_time"]));
    const coverageEnd = iso(firstValue(source, ["coverageEnd", "coverage_end", "endTime", "end_time"]));
    // A saved snapshot identity is itself a verified fact. Preserve it even
    // when an older project did not include a display coverage range; only the
    // absent horizon is omitted, so no validity marker is fabricated.
    return {
        id: resourceId("erp", snapshotId),
        resourceType: "erp",
        name: text(firstValue(source, ["filename", "fileName", "file_name", "name"])) || snapshotId,
        ...(coverageStart ? { validityStart: coverageStart } : {}),
        ...(coverageEnd ? { validityEnd: coverageEnd } : {}),
        validation: "validated-snapshot",
        metadata: {
            snapshotId,
            sha256: text(firstValue(source, ["sha256", "sha_256"])),
            sourceSha256: text(firstValue(source, ["sourceSha256", "source_sha256"])),
            source: text(firstValue(source, ["source", "provider"])),
            version: text(source.version),
            quality: text(firstValue(source, ["quality", "productClass", "product_class"])),
            recordCount: Number.isFinite(Number(firstValue(source, ["recordCount", "record_count"])))
                ? Number(firstValue(source, ["recordCount", "record_count"]))
                : null
        }
    };
}

function diagnosticDetails(component) {
    return {
        ...record(component),
        ...record(component?.details)
    };
}

/**
 * Convert the ERP component published by system diagnostics into a source
 * fact. Only named `coverage.end` / `coverageEnd` and named expiry fields are
 * accepted; unrelated diagnostic timestamps are never promoted to a horizon.
 */
export function buildPlannerErpDiagnosticResource(component) {
    if (!component || typeof component !== "object" || Array.isArray(component)) return null;
    const details = diagnosticDetails(component);
    const coverage = record(firstValue(details, ["coverage", "validity", "range"]));
    const coverageStart = firstValue(coverage, ["start", "startTime", "start_time"])
        ?? firstValue(details, ["coverageStart", "coverage_start"]);
    const coverageEnd = firstValue(coverage, ["end", "endTime", "end_time"])
        ?? firstValue(details, ["coverageEnd", "coverage_end"]);
    const expiry = firstValue(details, ["expiresAt", "expires_at"]);
    const validityEnd = iso(coverageEnd);
    const expiresAt = iso(expiry);
    const snapshotId = text(firstValue(details, ["snapshotId", "snapshot_id"]));
    const name = text(firstValue(details, ["filename", "fileName", "file_name", "name", "label"])) || "ERP";
    return {
        id: resourceId("erp", snapshotId || "service"),
        resourceType: "erp",
        name,
        ...(iso(coverageStart) ? { validityStart: iso(coverageStart) } : {}),
        ...(validityEnd ? { validityEnd } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        validation: text(component.status) || "published-diagnostics",
        metadata: {
            snapshotId,
            status: text(component.status),
            lastValidatedAt: iso(component.lastValidatedAt),
            source: text(firstValue(details, ["source", "provider"])),
            version: text(details.version),
            sha256: text(firstValue(details, ["sha256", "sha_256"]))
        }
    };
}

function normalizeFiniteRanges(ranges, resourceType, names = new Map()) {
    return (Array.isArray(ranges) ? ranges : [])
        .map((range) => {
            const id = text(range?.id);
            return finiteCoverage({
                id: resourceId(resourceType, id),
                resourceType,
                name: text(names.get(id)) || id,
                start: range?.startTime ?? range?.start ?? range?.startTimeMs,
                end: range?.endTime ?? range?.end ?? range?.endTimeMs,
                validation: "scene-coverage-validated",
                metadata: { sourceId: id }
            });
        })
        .filter(Boolean);
}

/**
 * Normalize scene-layer facts without claiming a temporal validation that the
 * layer did not expose. This makes imported layers inspectable by a future
 * planner while leaving their absence of a finite horizon explicit.
 */
export function normalizePlannerLayerFacts(layers) {
    return uniqueById((Array.isArray(layers) ? layers : [])
        .map((layer) => {
            const id = text(layer?.id);
            if (!id) return null;
            return {
                id,
                name: text(layer?.name) || id,
                type: text(layer?.type) || "UNKNOWN",
                sourceId: text(layer?.sourceId),
                active: layer?.active === true,
                visible: layer?.visible === true,
                sourceFormat: text(layer?.sourceFormat),
                sourceOrigin: text(layer?.sourceOrigin),
                validation: text(layer?.validation) || "scene-state-only",
                ...(iso(layer?.validityStart) ? { validityStart: iso(layer.validityStart) } : {}),
                ...(iso(layer?.validityEnd) ? { validityEnd: iso(layer.validityEnd) } : {})
            };
        })
        .filter(Boolean));
}

function layerCoverageResources(layers) {
    return layers
        .filter((layer) => {
            const format = text(layer?.sourceFormat).toUpperCase();
            return Boolean(layer?.validityEnd)
                && layer?.active === true
                // SP3 and OEM publish their product-level horizon above. A
                // visual duplicate must not add a second, misleading notice.
                && format !== "SP3"
                && format !== "OEM";
        })
        .map((layer) => finiteCoverage({
            id: resourceId("layer", layer.sourceId || layer.id),
            resourceType: "layer",
            name: layer.name,
            start: layer.validityStart,
            end: layer.validityEnd,
            validation: layer.validation,
            metadata: {
                layerId: layer.id,
                sourceId: layer.sourceId,
                sourceFormat: layer.sourceFormat,
                sourceOrigin: layer.sourceOrigin
            }
        }))
        .filter(Boolean);
}

/**
 * Build the exact resource/layer facts consumed by the planner bridge. Every
 * resulting temporal boundary comes from a validated scene range or an
 * explicitly named diagnostic field; no expiry or coverage is guessed.
 */
export function buildPlannerSourceSnapshot({
    manualErps = [],
    erpDiagnostic = null,
    preciseRanges = [],
    preciseNames = new Map(),
    oemRanges = [],
    oemNames = new Map(),
    layers = []
} = {}) {
    const layerFacts = normalizePlannerLayerFacts(layers);
    const erpDiagnosticResource = buildPlannerErpDiagnosticResource(erpDiagnostic);
    const resources = [
        ...(Array.isArray(manualErps) ? manualErps.map(normalizeManualErp).filter(Boolean) : []),
        ...(erpDiagnosticResource ? [erpDiagnosticResource] : []),
        ...normalizeFiniteRanges(preciseRanges, "sp3", preciseNames),
        ...normalizeFiniteRanges(oemRanges, "oem", oemNames),
        ...layerCoverageResources(layerFacts)
    ];
    return {
        resources: uniqueById(resources),
        layers: layerFacts
    };
}

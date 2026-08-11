import { formatReferenceFrame } from "../frames/referenceFrame.js";
import { PRECISE_PRODUCT_IMPORT_ERRORS } from "./import.js";

function text(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstText(sources, keys) {
    for (const source of sources) {
        const value = record(source);
        if (!value) continue;
        for (const key of keys) {
            const candidate = text(value[key]);
            if (candidate) return candidate;
        }
    }
    return "";
}

function firstPrimitiveText(sources, keys) {
    for (const source of sources) {
        const value = record(source);
        if (!value) continue;
        for (const key of keys) {
            const raw = value[key];
            if (raw && typeof raw !== "object") {
                const candidate = text(raw);
                if (candidate) return candidate;
            }
        }
    }
    return "";
}

function firstRecord(sources, keys) {
    for (const source of sources) {
        const value = record(source);
        if (!value) continue;
        for (const key of keys) {
            const candidate = record(value[key]);
            if (candidate) return candidate;
        }
    }
    return null;
}

function firstValue(sources, keys) {
    for (const source of sources) {
        const value = record(source);
        if (!value) continue;
        for (const key of keys) {
            if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
                return value[key];
            }
        }
    }
    return null;
}

function booleanValue(value) {
    if (typeof value === "boolean") return value;
    const normalized = text(value).toLowerCase();
    if ([
        "true", "available", "ready", "supported", "native",
        "terrestrial_realization_transform", "earth_orientation_transform",
        "approximate_earth_fixed", "legacy_compatibility"
    ].includes(normalized)) return true;
    if (["false", "unavailable", "blocked", "unsupported", "disabled"].includes(normalized)) return false;
    return null;
}

function booleanFromSources(sources, keys) {
    for (const source of sources) {
        const value = record(source);
        if (!value) continue;
        for (const key of keys) {
            const parsed = booleanValue(value[key]);
            if (parsed !== null) return parsed;
        }
    }
    return null;
}

function hasErpSource(sources) {
    for (const source of sources) {
        const value = record(source);
        if (!value) continue;
        const direct = value.erp ?? value.erp_file ?? value.erpFile;
        if (text(direct)) return true;
        const files = value.source_files ?? value.sourceFiles ?? value.files;
        if (!Array.isArray(files)) continue;
        if (files.some((file) => text(record(file)?.kind ?? record(file)?.type).toLowerCase() === "erp")) {
            return true;
        }
    }
    return false;
}

function isEarthFixedFrame(frame) {
    const normalized = text(frame).toUpperCase();
    return normalized === "ECEF"
        || normalized === "PEF"
        || normalized === "WGS84"
        || normalized.startsWith("ITRF");
}

function isApproximateEarthOrientation(earthOrientation, renderer) {
    if (renderer?.approximate === true) return true;
    const quality = firstText([earthOrientation, renderer], [
        "quality", "eop_quality", "eopQuality", "precision", "status"
    ]).toLowerCase();
    const source = firstText([earthOrientation, renderer], [
        "source", "mode", "method", "fallback", "origin"
    ]).toLowerCase();
    return quality === "approximate"
        || quality === "visual-fallback"
        || quality === "visual_fallback"
        || quality.includes("approximate")
        || quality.includes("visual")
        || source.includes("visual")
        || source.includes("fallback")
        || source.includes("approximate");
}

/**
 * Resolve the provenance of a precise-product frame without inventing an ITRF
 * transformation.  The Python service has used both the legacy `rendering`
 * object and the richer `renderer_reference` object, so this accepts either
 * representation while retaining the exact SP3 native realization.
 *
 * `runtimeFrame` is the frame of vectors that were actually returned by an
 * endpoint. It is intentionally separate from `nativeFrame`: a renderer may
 * safely return ITRF2020 for a native IGS20 product, but an unavailable
 * renderer must never be presented as ITRF merely because Cesium normally
 * consumes Earth-fixed positions.
 */
export function resolvePreciseProductFrameStatus(source = {}, { runtimeFrame = "" } = {}) {
    const root = record(source) || {};
    const metadata = [
        root,
        record(root.sp3),
        record(root.inputMetadata),
        record(root.input_metadata),
        record(root.catalogMeta),
        record(root.catalog_meta),
        record(root.product)
    ].filter(Boolean);
    const renderer = firstRecord(metadata, [
        "renderer_reference", "rendererReference", "rendering", "rendering_status", "renderingStatus"
    ]);
    const nativeFrameRecord = firstRecord(metadata, ["native_frame", "nativeFrame"]);
    const earthOrientationValue = firstValue([
        renderer,
        ...metadata
    ], ["earth_orientation", "earthOrientation", "eop", "eop_status", "eopStatus"]);
    const earthOrientation = record(earthOrientationValue)
        || (text(earthOrientationValue) ? { quality: text(earthOrientationValue) } : null);
    const eciConversion = firstRecord([
        renderer,
        ...metadata
    ], ["eci_conversion", "eciConversion", "inertial_conversion", "inertialConversion"]);

    const nativeFrameRecordName = firstText([nativeFrameRecord], [
        "realization", "reference_frame", "referenceFrame", "frame", "name"
    ]);
    const nativeRaw = firstText([
        renderer,
        ...metadata
    ], ["native_reference_frame", "nativeReferenceFrame", "native_frame_label", "nativeFrameLabel"])
        || nativeFrameRecordName
        || firstPrimitiveText([renderer, ...metadata], ["nativeFrame"])
        || firstText([renderer, ...metadata], ["source_frame", "sourceFrame"])
        || firstText(metadata, ["reference_frame", "referenceFrame", "frame", "coord_system", "coordinate_system"]);
    const returnedRaw = text(runtimeFrame) || firstText([
        renderer,
        ...metadata
    ], [
        "returned_frame", "returnedFrame", "output_frame", "outputFrame",
        "target_frame", "targetFrame", "requested_frame", "requestedFrame",
        "reference_frame", "referenceFrame", "frame"
    ]);
    const nativeFrame = formatReferenceFrame(nativeRaw, "");
    const returnedFrame = formatReferenceFrame(returnedRaw, "");
    const availability = renderer
        ? booleanValue(renderer.available ?? renderer.is_available ?? renderer.isAvailable ?? renderer.status)
        : null;
    const reason = firstText([renderer, ...metadata], ["reason", "message", "detail", "error"]);
    const targetRealization = firstText([renderer, ...metadata], ["target_realization", "targetRealization", "realization"]);
    const operation = firstText([renderer, ...metadata], [
        "terrestrial_realization_operation", "terrestrialRealizationOperation",
        "realization_operation", "realizationOperation", "operation", "transform", "transformation"
    ]);
    const backendDisplayLabel = firstText([renderer, ...metadata], [
        "display_label", "displayLabel", "display_frame", "displayFrame", "frame_display", "frameDisplay",
        "reference_frame_display", "referenceFrameDisplay"
    ]);
    const explicitErpApplied = booleanFromSources([
        eciConversion,
        earthOrientation,
        renderer,
        ...metadata
    ], [
        "erp_applied", "erpApplied", "earth_orientation_applied", "earthOrientationApplied", "applied"
    ]);
    const erpProvided = hasErpSource([renderer, ...metadata]);
    const eciAvailability = booleanFromSources([eciConversion, renderer, ...metadata], [
        "eci_available", "eciAvailable", "available", "enabled", "ready"
    ]);
    // A label alone is not permission to claim an ECI-capable route.  In
    // particular, an ERP can be present while the source realization lacks
    // the datum operation required by the backend.  An explicit unavailable
    // capability always wins over a stale/persisted display label.
    const erpApplied = (explicitErpApplied === true
        || backendDisplayLabel === "ITRF (con ERP aplicado)")
        && eciAvailability !== false;
    // An ERP may be attached without being applicable to the requested epoch.
    // Only an explicitly applied ERP capability unlocks ECI work.
    const eciAvailable = erpApplied && eciAvailability !== false;
    const eciReason = firstText([eciConversion, renderer, ...metadata], [
        "eci_reason", "eciReason", "reason", "message", "detail", "error"
    ]) || (eciAvailable
        ? ""
        : erpProvided
            ? "El ERP está disponible, pero falta una ruta de realización terrestre válida para convertir a ECI."
            : PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci);
    const approximate = !erpApplied || isApproximateEarthOrientation(earthOrientation, renderer);
    // Older persisted products may predate `renderer_reference`. If the
    // native realization and the runtime's Earth-fixed label differ, do not
    // make the latter look like a confirmed realization transform. Rendering
    // can still remain backwards-compatible, but the UI must expose the
    // native frame and the missing provenance.
    const unverifiedTerrestrialTransform = !renderer
        && Boolean(nativeFrame && returnedFrame)
        && (
            nativeFrame.toUpperCase() !== returnedFrame.toUpperCase()
            || isEarthFixedFrame(nativeFrame)
            || isEarthFixedFrame(returnedFrame)
        );

    // A GNSS product must never present an Earth-fixed rendering value as a
    // complete ITRF-to-ECI solution unless the imported ERP was actually
    // applied.  Keep the no-ERP label exact, while distinguishing the less
    // common case in which an ERP is attached but the source datum has no
    // registered route to ECI.
    const approximateFrameLabel = erpProvided
        ? "Marco terrestre aproximado (ERP sin ruta ECI)"
        : "Marco terrestre aproximado (sin ERP)";
    let displayFrame = erpApplied
        ? "ITRF (con ERP aplicado)"
        : approximateFrameLabel;

    let renderingLabel;
    if (availability === false) {
        renderingLabel = reason
            ? `No disponible: ${reason}`
            : "No disponible: no hay una transformación terrestre configurada.";
    } else if (erpApplied) {
        renderingLabel = "ITRF (con ERP aplicado)";
    } else if (unverifiedTerrestrialTransform) {
        renderingLabel = `${approximateFrameLabel}. Se conserva ${nativeFrame || "el marco nativo"} como procedencia.`;
    } else if (approximate) {
        renderingLabel = approximateFrameLabel;
    } else if (availability === true) {
        const target = returnedFrame || "marco terrestre declarado";
        const realization = targetRealization ? ` / ${targetRealization}` : "";
        renderingLabel = `Disponible en ${target}${realization}`;
    } else {
        renderingLabel = "Estado de representación no declarado";
    }

    return {
        nativeFrame: nativeFrame || "Marco nativo no declarado",
        returnedFrame: returnedFrame || "",
        displayFrame,
        available: availability,
        approximate,
        unverifiedTerrestrialTransform,
        reason,
        operation,
        targetRealization,
        earthOrientation,
        erpProvided,
        erpApplied,
        eciAvailable,
        eciReason,
        renderingLabel
    };
}

/** True only for a product explicitly marked as non-renderable. */
export function isPreciseProductRenderingUnavailable(source = {}) {
    return resolvePreciseProductFrameStatus(source).available === false;
}

/**
 * Reusable guard for a future propagator-comparison UI.  Rendering a native
 * terrestrial SP3 remains possible without ERP, but a comparison in ECI is
 * intentionally a different capability and must be blocked.
 */
export function assertPreciseProductEciAvailable(source = {}) {
    const status = resolvePreciseProductFrameStatus(source);
    if (!status.eciAvailable) {
        throw new Error(status.erpProvided
            ? (status.eciReason || "La conversión a ECI no está disponible para este producto.")
            : PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci);
    }
    return status;
}

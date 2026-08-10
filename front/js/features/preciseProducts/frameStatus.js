import { formatReferenceFrame } from "../frames/referenceFrame.js";

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
    const approximate = availability !== false && isApproximateEarthOrientation(earthOrientation, renderer);
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

    let displayFrame = backendDisplayLabel || returnedFrame || nativeFrame || "Marco no declarado";
    if (availability === false) {
        displayFrame = nativeFrame || "Marco nativo no declarado";
    } else if (approximate && isEarthFixedFrame(returnedFrame || nativeFrame)) {
        // Cesium may still use these Earth-fixed coordinates for a visual
        // fallback, but this label makes the absent EOP/ERP solution explicit.
        displayFrame = "Terrestre aproximado (sin EOP)";
    } else if (unverifiedTerrestrialTransform) {
        displayFrame = nativeFrame.toUpperCase() === returnedFrame.toUpperCase()
            ? `${nativeFrame} nativo (sin EOP declarado)`
            : nativeFrame;
    }

    let renderingLabel;
    if (availability === false) {
        renderingLabel = reason
            ? `No disponible: ${reason}`
            : "No disponible: no hay una transformación terrestre configurada.";
    } else if (approximate && isEarthFixedFrame(returnedFrame || nativeFrame)) {
        renderingLabel = "Terrestre aproximado (sin EOP)";
    } else if (unverifiedTerrestrialTransform) {
        renderingLabel = nativeFrame.toUpperCase() === returnedFrame.toUpperCase()
            ? `No verificado: ${nativeFrame} se conserva como marco nativo, sin procedencia EOP/ERP declarada.`
            : `No verificado: falta la procedencia de la transformación desde ${nativeFrame} hacia ${returnedFrame}.`;
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
        renderingLabel
    };
}

/** True only for a product explicitly marked as non-renderable. */
export function isPreciseProductRenderingUnavailable(source = {}) {
    return resolvePreciseProductFrameStatus(source).available === false;
}

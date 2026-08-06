import { normalizeManualOrbitPreviewReferenceFrame } from "../frames/referenceFrame.js";

function asIsoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Builds inspector contexts from the runtime's layer services. Keeping the
 * runtime lookups injected makes this presentation/domain bridge testable and
 * keeps Cesium bootstrap code free of inspector policy.
 */
export function createPropagatedParametersContextBuilder(services) {
    const {
        isCompositeLayerActive,
        isGroundStationLayerId,
        isCelestialBodyLayerId,
        getSatelliteSourceIdFromLayerId,
        getCompositeLayerTelemetry,
        getCompositeLayerMeta,
        getObjectTimeRange,
        getManualOrbitProjectEntry,
        getLayerDisplayName,
        getSimulationTelemetryContext,
        getManualOrbitDefinitionSource
    } = services;

    return function buildPropagatedParametersContext(detail = {}) {
        const source = String(detail.source || "layer").trim() || "layer";
        if (source === "manual-design") {
            const manualOrbit = detail.manualOrbit && typeof detail.manualOrbit === "object"
                ? detail.manualOrbit
                : null;
            if (!manualOrbit) return null;

            const startTime = asIsoDate(detail.startTime || manualOrbit.epochStartUtc || manualOrbit.epochUtc);
            const endTime = asIsoDate(detail.endTime || manualOrbit.epochEndUtc);
            if (!startTime || !endTime || Date.parse(endTime) <= Date.parse(startTime)) return null;

            const inspectorManualOrbit = {
                ...manualOrbit,
                definitionSource: manualOrbit.definitionSource
                    ?? manualOrbit.definition_source
                    ?? getManualOrbitDefinitionSource()
            };
            return {
                id: null,
                source,
                kind: "manual-design",
                name: String(inspectorManualOrbit.name || "Manual Orbit").trim() || "Manual Orbit",
                active: true,
                manualOrbit: inspectorManualOrbit,
                startTime,
                endTime,
                timeRange: { mode: "manual-design", startDate: startTime, endDate: endTime },
                referenceFrame: normalizeManualOrbitPreviewReferenceFrame(
                    inspectorManualOrbit.previewReferenceFrame,
                    "eme2000"
                ).toUpperCase(),
                propagator: inspectorManualOrbit.propagator || null
            };
        }

        const id = String(detail.id || "").trim();
        if (!id || !isCompositeLayerActive(id) || isGroundStationLayerId(id) || isCelestialBodyLayerId(id)) {
            return null;
        }

        const sourceId = getSatelliteSourceIdFromLayerId(id);
        const telemetry = getCompositeLayerTelemetry(id);
        const catalogMeta = getCompositeLayerMeta(id);
        const timeRange = getObjectTimeRange(id, telemetry);
        const manualOrbit = getManualOrbitProjectEntry(sourceId) || null;
        const sourceFormat = String(catalogMeta?.sourceFormat || catalogMeta?.source_format || "TLE").toUpperCase();
        const referenceFrame = manualOrbit
            ? normalizeManualOrbitPreviewReferenceFrame(
                manualOrbit.previewReferenceFrame ?? manualOrbit.preview_reference_frame,
                "eme2000"
            ).toUpperCase()
            : (sourceFormat === "OEM"
                ? (telemetry?.position_frame || telemetry?.reference_frame || telemetry?.frame || null)
                : "TEME");

        return {
            id,
            source,
            kind: "layer",
            sourceId,
            name: getLayerDisplayName(id),
            active: true,
            telemetry,
            catalogMeta,
            manualOrbit,
            startTime: asIsoDate(detail.startTime || timeRange?.startDate),
            endTime: asIsoDate(detail.endTime || timeRange?.endDate),
            timeRange,
            simulation: getSimulationTelemetryContext(),
            referenceFrame,
            propagator: manualOrbit?.propagator || telemetry?.propagator || null
        };
    };
}

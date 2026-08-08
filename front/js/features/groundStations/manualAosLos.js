import { toManualOrbitApiPayload } from "../manualOrbit/editorState.js";

/**
 * A manual orbit is not registered in the catalogue runtime, therefore an
 * AOS/LOS request must carry its authored definition instead of a `sat_id`.
 * Keep that conversion independent from Cesium so the HTTP boundary can be
 * tested without a renderer.
 */
export class ManualAosLosRequestError extends Error {
    constructor(message) {
        super(message);
        this.name = "ManualAosLosRequestError";
    }
}

function asValidDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function manualDefinitionSource(manualOrbit) {
    const value = String(
        manualOrbit?.definitionSource
        ?? manualOrbit?.definition_source
        ?? "keplerian"
    ).trim().toLowerCase().replace(/[-\s]+/g, "_");
    return value === "statevector" || value === "state_vector" ? "state_vector" : "keplerian";
}

/**
 * Resolve the exact range authored by the manual-orbit designer.
 *
 * A rolling 24-hour forecast would query the model outside its design
 * ephemeris and make the pass table disagree with the timeline.  Manual
 * layers consequently require an explicit, valid start/end pair.
 */
export function resolveManualAosLosWindow(manualOrbit) {
    const start = asValidDate(
        manualOrbit?.startTime
        ?? manualOrbit?.start_time
        ?? manualOrbit?.epochStartUtc
        ?? manualOrbit?.epoch_start_utc
    );
    const end = asValidDate(
        manualOrbit?.endTime
        ?? manualOrbit?.end_time
        ?? manualOrbit?.epochEndUtc
        ?? manualOrbit?.epoch_end_utc
    );

    if (!start || !end || end <= start) {
        throw new ManualAosLosRequestError(
            "La órbita manual no conserva una ventana de diseño válida. Edítala y vuelve a propagarla antes de calcular AOS/LOS."
        );
    }
    return {
        startDate: start,
        endDate: end,
        source: "manual-design"
    };
}

/**
 * Produce the POST body accepted by `/api/aos-los` for an authored manual
 * orbit.  The API receives the same native propagator and force composition
 * used by the manual-orbit endpoint; no TLE or synthetic catalogue ID leaks
 * into this path.
 */
export function buildManualAosLosRequest({
    manualOrbit,
    station,
    stepSeconds,
    includeSamples,
    chartPaddingSeconds = null
}) {
    if (!manualOrbit || typeof manualOrbit !== "object") {
        throw new ManualAosLosRequestError("La definición de la órbita manual ya no está disponible.");
    }
    if (!station || typeof station !== "object") {
        throw new ManualAosLosRequestError("La estación terrestre no tiene una configuración válida.");
    }

    const window = resolveManualAosLosWindow(manualOrbit);
    const requestStepSeconds = Number(stepSeconds);
    if (!Number.isFinite(requestStepSeconds) || requestStepSeconds <= 0) {
        throw new ManualAosLosRequestError("El paso de análisis AOS/LOS debe ser mayor que cero.");
    }

    const source = manualDefinitionSource(manualOrbit);
    const serializedOrbit = toManualOrbitApiPayload(manualOrbit, {
        source,
        startTime: window.startDate,
        endTime: window.endDate,
        stepSeconds: requestStepSeconds,
        includeVelocity: false
    });

    return {
        window,
        body: {
            source: {
                kind: "manual",
                manualOrbit: serializedOrbit
            },
            station: { ...station },
            start_time: window.startDate.toISOString(),
            end_time: window.endDate.toISOString(),
            step_seconds: requestStepSeconds,
            include_samples: includeSamples === true,
            ...(chartPaddingSeconds !== null
                && chartPaddingSeconds !== undefined
                && Number.isFinite(Number(chartPaddingSeconds))
                && Number(chartPaddingSeconds) >= 0
                ? { chart_padding_seconds: Number(chartPaddingSeconds) }
                : {})
        }
    };
}

/**
 * A compact revision token for invalidating an in-flight manual request when
 * the authored orbit is edited/replaced in the workspace.
 */
export function manualAosLosSignature(manualOrbit) {
    if (!manualOrbit || typeof manualOrbit !== "object") return "";
    const window = resolveManualAosLosWindow(manualOrbit);
    const serializedOrbit = toManualOrbitApiPayload(manualOrbit, {
        source: manualDefinitionSource(manualOrbit),
        startTime: window.startDate,
        endTime: window.endDate,
        includeVelocity: false
    });
    return JSON.stringify(serializedOrbit);
}

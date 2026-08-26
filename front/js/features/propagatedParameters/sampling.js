/**
 * Sampling plan for the propagated-parameters inspector.
 *
 * This is deliberately separate from the scene-orbit sampling policy.  The
 * inspector is an operator request: when a concrete cadence is selected, the
 * full requested series must be calculated rather than silently coarsened for
 * presentation convenience.  The UI can still make the cost visible and let
 * the user cancel the normal operation ledger entry.
 */

export const PROPAGATED_PARAMETERS_MIN_SAMPLES = 25;
// Automatic sampling is a presentation policy, not an operator-selected
// cadence. Keep it bounded for very long simulation windows so simply opening
// the inspector does not materialise thousands of rows. Explicit selections
// never use this cap.
export const PROPAGATED_PARAMETERS_AUTOMATIC_MAX_SAMPLES = 241;
export const PROPAGATED_PARAMETERS_SAMPLE_INTERVALS_SECONDS = new Set([
    60, 300, 900, 1800, 3600, 10800, 21600, 86400
]);

// A few hundred full state evaluations can already be noticeable for a
// transformed/tabular product or a manual numerical model.  This is only a
// disclosure threshold: it never changes the selected cadence.
export const PROPAGATED_PARAMETERS_EXPENSIVE_SAMPLE_THRESHOLD = 300;
export const PROPAGATED_PARAMETERS_LONG_RUNNING_SAMPLE_THRESHOLD = 1_000;

function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function formatSamples(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString("es-ES");
}

function formatCadence(value) {
    const seconds = finitePositive(value);
    if (!seconds) return "cadencia automática";
    if (seconds % 86400 === 0) return `${seconds / 86400} dÃ­a${seconds === 86400 ? "" : "s"}`;
    if (seconds % 3600 === 0) return `${seconds / 3600} h`;
    if (seconds % 60 === 0) return `${seconds / 60} min`;
    return `${seconds.toLocaleString("es-ES", { maximumFractionDigits: 2 })} s`;
}

/** Return a supported explicit cadence, or ``null`` for automatic mode. */
export function normalizePropagatedParametersSamplingInterval(value) {
    if (value === null || value === undefined || value === "" || value === "auto") return null;
    const seconds = Number(value);
    return PROPAGATED_PARAMETERS_SAMPLE_INTERVALS_SECONDS.has(seconds) ? seconds : null;
}

function automaticSamplingIntervalSeconds(hours) {
    // A short operational window benefits from a denser default, but this is
    // a policy choice rather than a hidden hard sample ceiling.  Every point
    // in the plan below is still sent to the service.
    if (hours <= 6) return 300;
    if (hours <= 48) return 900;
    return 3600;
}

/**
 * Build the exact sampling contract sent to ``/api/orbit-parameters``.
 *
 * A concrete selected cadence always produces the complete count implied by
 * that cadence and interval. In particular, a 24 hour request at one minute
 * yields 1,441 samples -- never the former 121-point presentation cap.
 * Automatic mode remains an adaptive, bounded presentation policy because
 * the operator did not request a particular physical cadence.
 */
export function resolvePropagatedParametersSampling(range, selectedIntervalSeconds = null) {
    const hours = finitePositive(range?.hours);
    const durationSeconds = hours ? hours * 3_600 : null;
    if (!durationSeconds) {
        return {
            mode: "automatic",
            requestedIntervalSeconds: null,
            automaticIntervalSeconds: null,
            effectiveIntervalSeconds: null,
            requestedSamples: 2,
            sampleCount: 2,
            fullResolution: false,
            limited: false,
            expensive: false,
            longRunning: false,
            taskTitle: "Calculando efemérides",
            taskStage: "Preparando efemérides",
            taskMessage: "Preparando la serie de efemérides solicitada."
        };
    }

    const selected = normalizePropagatedParametersSamplingInterval(selectedIntervalSeconds);
    const automaticIntervalSeconds = selected ? null : automaticSamplingIntervalSeconds(hours);
    const requestedIntervalSeconds = selected ?? automaticIntervalSeconds;
    const requestedSamples = Math.ceil(durationSeconds / requestedIntervalSeconds) + 1;
    // Automatic mode retains enough vertices to make a short inspector window
    // useful without making an incidental long window expensive. An explicit
    // cadence, by contrast, is honoured exactly and never reaches this cap.
    const sampleCount = selected
        ? requestedSamples
        : Math.max(
            PROPAGATED_PARAMETERS_MIN_SAMPLES,
            Math.min(PROPAGATED_PARAMETERS_AUTOMATIC_MAX_SAMPLES, requestedSamples)
        );
    const effectiveIntervalSeconds = durationSeconds / Math.max(1, sampleCount - 1);
    const expensive = sampleCount >= PROPAGATED_PARAMETERS_EXPENSIVE_SAMPLE_THRESHOLD;
    const longRunning = sampleCount >= PROPAGATED_PARAMETERS_LONG_RUNNING_SAMPLE_THRESHOLD;
    const cadenceLabel = selected
        ? formatCadence(selected)
        : `automática (hasta ${formatCadence(effectiveIntervalSeconds)})`;
    const taskMessage = expensive
        ? `Se calcularán las ${formatSamples(sampleCount)} muestras completas a cadencia ${cadenceLabel}. Esta tarea puede tardar unos momentos; puedes seguir trabajando o cancelarla desde Tareas, arriba a la derecha.`
        : `Calculando las ${formatSamples(sampleCount)} muestras completas a cadencia ${cadenceLabel}.`;

    return {
        mode: selected ? "selected" : "automatic",
        requestedIntervalSeconds: selected,
        automaticIntervalSeconds,
        effectiveIntervalSeconds,
        requestedSamples,
        sampleCount,
        // Retained for consumers of the former presentation contract. It is
        // intentionally always false: no selected cadence is silently capped.
        // Automatic mode chooses its own cadence up front rather than falsely
        // claiming that an operator-selected cadence was limited.
        limited: false,
        // This records that an explicit operator cadence was honoured. The
        // automatic policy chooses its own bounded resolution by design.
        fullResolution: selected !== null,
        expensive,
        longRunning,
        taskTitle: expensive ? "Calculando efemérides de alta resolución" : "Calculando efemérides",
        taskStage: `Propagando ${formatSamples(sampleCount)} muestras`,
        taskMessage
    };
}

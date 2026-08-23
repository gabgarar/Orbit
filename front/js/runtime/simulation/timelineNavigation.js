/**
 * Interaction math for the compact simulation timeline.
 *
 * The visual control is a native range input, but the surrounding tick area
 * is intentionally also navigable with a pointer or wheel.  Keeping the
 * coordinate conversion here makes that supplemental interaction testable
 * without a browser or a Cesium viewer.
 */

export function normalizeTimelineSteps(value, fallback = 1000) {
    const requested = Math.floor(Number(value));
    if (Number.isFinite(requested) && requested > 0) return requested;
    const safeFallback = Math.floor(Number(fallback));
    return Number.isFinite(safeFallback) && safeFallback > 0 ? safeFallback : 1;
}

export function clampTimelineStep(value, steps) {
    const maximum = normalizeTimelineSteps(steps);
    const requested = Number(value);
    const safeValue = Number.isFinite(requested) ? Math.round(requested) : 0;
    return Math.min(maximum, Math.max(0, safeValue));
}

/** Convert a pointer position in a track rectangle to a discrete timeline step. */
export function timelineStepFromPointer({ clientX, left, width, steps } = {}) {
    const trackWidth = Number(width);
    const pointerX = Number(clientX);
    const trackLeft = Number(left);
    if (!Number.isFinite(trackWidth) || trackWidth <= 0
        || !Number.isFinite(pointerX) || !Number.isFinite(trackLeft)) {
        return null;
    }
    const maximum = normalizeTimelineSteps(steps);
    const ratio = Math.min(1, Math.max(0, (pointerX - trackLeft) / trackWidth));
    return clampTimelineStep(ratio * maximum, maximum);
}

/**
 * Move through a timeline with a wheel or horizontal trackpad gesture.
 *
 * One ordinary wheel notch advances roughly 0.1% of the available timeline.
 * The small floor preserves useful navigation in short ranges while a larger
 * wheel/trackpad gesture naturally travels farther in long ranges.
 */
export function timelineStepFromWheel({
    currentStep,
    steps,
    deltaX = 0,
    deltaY = 0,
    deltaMode = 0
} = {}) {
    const maximum = normalizeTimelineSteps(steps);
    const horizontal = Number(deltaX);
    const vertical = Number(deltaY);
    const primaryDelta = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;
    if (!Number.isFinite(primaryDelta) || primaryDelta === 0) {
        return clampTimelineStep(currentStep, maximum);
    }

    // DOM_DELTA_LINE and DOM_DELTA_PAGE need a comparable pixel magnitude
    // before determining the number of ordinary notches represented.
    const mode = Number(deltaMode);
    const modeScale = mode === 1 ? 16 : (mode === 2 ? 800 : 1);
    const notchCount = Math.max(1, Math.round((Math.abs(primaryDelta) * modeScale) / 80));
    const stepsPerNotch = Math.max(1, Math.round(maximum / 1000));
    const direction = primaryDelta > 0 ? 1 : -1;
    return clampTimelineStep(
        clampTimelineStep(currentStep, maximum) + (direction * stepsPerNotch * notchCount),
        maximum
    );
}

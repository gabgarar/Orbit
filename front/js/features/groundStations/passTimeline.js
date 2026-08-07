function timestamp(value) {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Select the instant represented by a pass mark in the global timeline.
 *
 * The marker deliberately prefers the instant of maximum elevation: it is the
 * most useful single instant to inspect and it remains inside the validated
 * AOS/LOS window. Older responses without that sample retain the midpoint and
 * AOS fallbacks.
 */
export function getPassTimelineMarker(pass) {
    const peakTime = timestamp(pass?.max_elevation_time);
    if (peakTime !== null) return { time: peakTime, label: "máxima elevación" };

    const aosTime = timestamp(pass?.aos);
    const losTime = timestamp(pass?.los);
    if (aosTime !== null && losTime !== null) return { time: (aosTime + losTime) / 2, label: "punto medio" };
    if (aosTime !== null) return { time: aosTime, label: "inicio del pase" };
    return null;
}

/** Return a timeline percentage for a valid instant, otherwise null. */
export function getTimelinePosition(timeValue, startValue, endValue) {
    const time = timestamp(timeValue);
    const start = timestamp(startValue);
    const end = timestamp(endValue);
    if (![time, start, end].every(Number.isFinite) || end <= start) return null;
    return ((time - start) / (end - start)) * 100;
}

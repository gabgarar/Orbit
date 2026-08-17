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
 * A green maximum-elevation marker must be backed by the physical sample
 * reported by AOS/LOS. A midpoint (or AOS) can be useful for navigation, but
 * is not a maximum and must not enter this marker contract as one.
 */
export function getPassTimelineMarker(pass) {
    const peakTime = timestamp(pass?.max_elevation_time);
    if (peakTime !== null) return { time: peakTime, label: "máxima elevación" };
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

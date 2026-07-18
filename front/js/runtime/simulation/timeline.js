export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function getTimelineRatio(dateValue, startDate, endDate) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const span = Math.max(1000, endMs - startMs);
    return clamp((date.getTime() - startMs) / span, 0, 1);
}

export function getDateAtTimelineRatio(ratio, startDate, endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const span = Math.max(1000, endMs - startMs);
    return new Date(startMs + span * clamp(Number(ratio) || 0, 0, 1));
}

export function getRangeHours(startDate, endDate) {
    return Math.max(0, (new Date(endDate).getTime() - new Date(startDate).getTime()) / (60 * 60 * 1000));
}

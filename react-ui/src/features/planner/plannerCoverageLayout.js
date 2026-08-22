/**
 * Presentation-only geometry for finite planner coverage intervals.
 *
 * A coverage fact may intersect many UTC days, but it is still one fact. The
 * calendar uses these segments to draw one continuous band per visible week
 * row (or one band across a day/week viewport) instead of cloning an event
 * chip into every covered cell.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

function timestamp(value) {
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
}

function positiveInteger(value, fallback) {
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

/**
 * Split finite coverage ranges at visual row boundaries.
 *
 * `start` and `end` must be UTC-midnight aligned view bounds. Segments carry
 * zero-based `row`, `column` and `span` values so callers can place them in a
 * CSS grid without making a copy for every individual calendar day.
 */
export function buildPlannerCoverageSegments(events, { start, end, columns = 7 } = {}) {
    const viewportStart = timestamp(start);
    const viewportEnd = timestamp(end);
    const columnCount = positiveInteger(columns, 7);
    if (viewportStart === null || viewportEnd === null || viewportEnd <= viewportStart) return [];

    return (Array.isArray(events) ? events : []).flatMap((event) => {
        const eventStart = timestamp(event?.start);
        const eventEnd = timestamp(event?.end);
        if (eventStart === null || eventEnd === null || eventEnd <= eventStart) return [];
        const visibleStart = Math.max(eventStart, viewportStart);
        const visibleEnd = Math.min(eventEnd, viewportEnd);
        if (visibleEnd <= visibleStart) return [];

        // The upper end of an interval is exclusive. ceil therefore includes
        // the final partial UTC day while excluding a day that starts exactly
        // at the event's end.
        let startDay = Math.max(0, Math.floor((visibleStart - viewportStart) / DAY_MS));
        const endDay = Math.max(startDay + 1, Math.ceil((visibleEnd - viewportStart) / DAY_MS));
        const segments = [];
        let labelPlaced = false;
        while (startDay < endDay) {
            const row = Math.floor(startDay / columnCount);
            const rowEnd = (row + 1) * columnCount;
            const segmentEnd = Math.min(endDay, rowEnd);
            const segmentStartMs = Math.max(visibleStart, viewportStart + startDay * DAY_MS);
            const segmentEndMs = Math.min(visibleEnd, viewportStart + segmentEnd * DAY_MS);
            const startFraction = (segmentStartMs - (viewportStart + startDay * DAY_MS)) / DAY_MS;
            const endInsetFraction = ((viewportStart + segmentEnd * DAY_MS) - segmentEndMs) / DAY_MS;
            // A label attached to a tiny clipped fragment gets visually cut
            // off at the range boundary.  Keep that fragment as an
            // unlabelled rail and use the next segment with enough visible
            // width; if none exists, the title/ARIA label still identifies it.
            const visibleColumns = segmentEnd - startDay - startFraction - endInsetFraction;
            const labelled = !labelPlaced && visibleColumns >= 0.6;
            segments.push({
                event,
                row,
                column: startDay - row * columnCount,
                span: segmentEnd - startDay,
                labelled,
                startsAtViewportBoundary: visibleStart === viewportStart,
                // Preserve an intraday hand-off (for example finals2000A
                // rapid -> prediction) instead of visually extending both
                // neighbouring ranges across the complete calendar day.
                startFraction: Math.max(0, Math.min(1, startFraction)),
                endInsetFraction: Math.max(0, Math.min(1, endInsetFraction))
            });
            if (labelled) labelPlaced = true;
            startDay = segmentEnd;
        }
        return segments;
    });
}

/** Return true if a point or finite range is part of the current view. */
export function plannerEventIsInView(event, { start, end } = {}) {
    const viewportStart = timestamp(start);
    const viewportEnd = timestamp(end);
    const eventStart = timestamp(event?.start);
    const eventEnd = timestamp(event?.end ?? event?.start);
    if (viewportStart === null || viewportEnd === null || eventStart === null || eventEnd === null || viewportEnd <= viewportStart) return false;
    if (eventStart === eventEnd) return eventStart >= viewportStart && eventStart < viewportEnd;
    return eventStart < viewportEnd && eventEnd > viewportStart;
}

/**
 * Find an adjacent event in the complete currently visible-filtered stream,
 * rather than only in the events painted by the current calendar period.
 */
export function plannerAdjacentVisibleEvent(events, selectedId, direction) {
    const source = Array.isArray(events) ? events : [];
    const offset = Number(direction) < 0 ? -1 : Number(direction) > 0 ? 1 : 0;
    if (!offset || !selectedId) return null;
    const index = source.findIndex((event) => event?.id === selectedId);
    const targetIndex = index + offset;
    return index >= 0 && targetIndex >= 0 && targetIndex < source.length ? source[targetIndex] : null;
}

/** Convert an event's UTC start to the cursor day used by all three views. */
export function plannerCursorForEvent(event) {
    const value = timestamp(event?.start);
    if (value === null) return null;
    const date = new Date(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

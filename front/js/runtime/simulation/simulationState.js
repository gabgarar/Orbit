export const SIMULATION_MODE_REALTIME = "realtime";
export const SIMULATION_MODE_RANGE = "range";
export const SIMULATION_MODE_STATIC = "static";

export function createSimulationState(now = new Date()) {
    return {
        mode: SIMULATION_MODE_REALTIME,
        startDate: new Date(now),
        endDate: new Date(now),
        currentDate: new Date(now),
        speed: 1,
        playing: false
    };
}

export function setSimulationRange(state, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return false;
    state.startDate = start;
    state.endDate = end;
    state.currentDate = new Date(start);
    return true;
}

/**
 * Return the finite interval that is actively driving the shared simulation
 * clock. `startDate`/`endDate` remain populated while the clock is realtime
 * or static for implementation convenience, but those retained values are
 * not an authored simulation domain and must never leak into analysis UI.
 */
export function getActiveSimulationRange(state) {
    if (!state || state.mode !== SIMULATION_MODE_RANGE) return null;
    const start = new Date(state.startDate);
    const end = new Date(state.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return null;
    }
    return {
        mode: SIMULATION_MODE_RANGE,
        source: "simulation-range",
        startTime: start.toISOString(),
        endTime: end.toISOString()
    };
}

export function advanceSimulation(state, elapsedMs) {
    // A static scene intentionally keeps the sampled instant unchanged even
    // if a caller tries to advance the shared clock.
    if (state.mode === SIMULATION_MODE_STATIC) return state.currentDate;
    if (!state.isPlaying && !state.playing) return state.currentDate;
    const direction = state.rewind ? -1 : 1;
    const next = new Date(state.currentDate.getTime() + (Math.max(0, elapsedMs) * state.speed * direction));
    if (state.mode === SIMULATION_MODE_RANGE && (next < state.startDate || next > state.endDate)) {
        state.currentDate = new Date(next < state.startDate ? state.startDate : state.endDate);
        state.isPlaying = false;
        state.playing = false;
        return state.currentDate;
    }
    state.currentDate = next;
    return state.currentDate;
}

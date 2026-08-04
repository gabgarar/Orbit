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

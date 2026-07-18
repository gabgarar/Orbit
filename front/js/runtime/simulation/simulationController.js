import { advanceSimulation, SIMULATION_MODE_REALTIME } from "./simulationState.js";

/** Keeps simulation time progression independent from Cesium and UI details. */
export function createSimulationController({ state, now = () => Date.now(), onDateChange }) {
    function tick() {
        const timestamp = now();
        const elapsedMs = Math.max(0, timestamp - state.lastTickTimestamp);
        state.lastTickTimestamp = timestamp;

        if (state.mode === SIMULATION_MODE_REALTIME) {
            state.currentDate = new Date(timestamp);
        } else if (state.isPlaying) {
            advanceSimulation(state, elapsedMs);
        } else {
            return state.currentDate;
        }

        onDateChange?.(state.currentDate);
        return state.currentDate;
    }

    return { tick };
}

import { advanceSimulation, SIMULATION_MODE_REALTIME, SIMULATION_MODE_STATIC } from "./simulationState.js";

/** Keeps simulation time progression independent from Cesium and UI details. */
export function createSimulationController({ state, now = () => Date.now(), onDateChange }) {
    function tick() {
        const timestamp = now();
        const elapsedMs = Math.max(0, timestamp - state.lastTickTimestamp);
        state.lastTickTimestamp = timestamp;

        if (state.mode === SIMULATION_MODE_STATIC) {
            return state.currentDate;
        }

        if (state.mode === SIMULATION_MODE_REALTIME) {
            // Realtime is still a controllable clock. When explicitly
            // paused, retain the last sampled wall-clock instant instead of
            // replacing it on every tick.
            if (state.isPlaying === false) {
                return state.currentDate;
            }
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

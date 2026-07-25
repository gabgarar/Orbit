import assert from "node:assert/strict";
import test from "node:test";

import { createSimulationController } from "../../js/runtime/simulation/simulationController.js";
import { SIMULATION_MODE_REALTIME, SIMULATION_MODE_STATIC } from "../../js/runtime/simulation/simulationState.js";

test("a paused realtime clock retains its sampled instant", () => {
    let timestamp = 2_000;
    const changes = [];
    const state = {
        mode: SIMULATION_MODE_REALTIME,
        currentDate: new Date(1_000),
        lastTickTimestamp: 1_000,
        isPlaying: false
    };
    const controller = createSimulationController({
        state,
        now: () => timestamp,
        onDateChange: (date) => changes.push(date.getTime())
    });

    controller.tick();

    assert.equal(state.currentDate.getTime(), 1_000);
    assert.equal(state.lastTickTimestamp, 2_000);
    assert.deepEqual(changes, []);
});

test("resuming realtime re-aligns the clock with the current wall instant", () => {
    let timestamp = 2_000;
    const state = {
        mode: SIMULATION_MODE_REALTIME,
        currentDate: new Date(1_000),
        lastTickTimestamp: 1_000,
        isPlaying: false
    };
    const controller = createSimulationController({ state, now: () => timestamp });

    controller.tick();
    timestamp = 8_000;
    state.isPlaying = true;
    controller.tick();

    assert.equal(state.currentDate.getTime(), 8_000);
    assert.equal(state.lastTickTimestamp, 8_000);
});

test("a static clock keeps its selected frame even when marked as playing", () => {
    let timestamp = 5_000;
    const changes = [];
    const state = {
        mode: SIMULATION_MODE_STATIC,
        currentDate: new Date(1_000),
        lastTickTimestamp: 1_000,
        isPlaying: true,
        playing: true
    };
    const controller = createSimulationController({
        state,
        now: () => timestamp,
        onDateChange: (date) => changes.push(date.getTime())
    });

    controller.tick();

    assert.equal(state.currentDate.getTime(), 1_000);
    assert.equal(state.lastTickTimestamp, 5_000);
    assert.deepEqual(changes, []);
});

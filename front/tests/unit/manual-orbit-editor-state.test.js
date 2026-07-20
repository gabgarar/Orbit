import assert from "node:assert/strict";
import test from "node:test";

import {
    createDefaultManualOrbitState,
    normalizeManualOrbitState,
    synchronizeManualOrbitState,
    toManualOrbitApiPayload
} from "../../js/features/manualOrbit/editorState.js";
import { OrbitalElementsValidationError } from "../../js/features/manualOrbit/orbitalElements.js";

function approximately(actual, expected, tolerance = 1e-8) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test("manual-orbit editor defaults to one canonical ECI/Kep state", () => {
    const state = createDefaultManualOrbitState({ now: "2026-07-20T10:15:00Z" });

    assert.equal(state.epochUtc, "2026-07-20T10:15:00.000Z");
    assert.equal(state.propagator, "sgp4");
    assert.equal(state.keplerian.semiMajorAxisKm, 6878);
    assert.equal(state.stateVector.positionEciKm.x, 6871.122);
    assert.ok(Math.hypot(
        state.stateVector.velocityEciKmS.x,
        state.stateVector.velocityEciKmS.y,
        state.stateVector.velocityEciKmS.z
    ) > 7.6);
    assert.equal("positionXKm" in state.stateVector, false);
});

test("normalizer accepts legacy flat state-vector editor fields and derives Keplerian elements", () => {
    const state = normalizeManualOrbitState({
        name: "Flat vector",
        epochUtc: "2026-07-20T10:15:00Z",
        source: "stateVector",
        stateVector: {
            positionXKm: 7000,
            positionYKm: 0,
            positionZKm: 0,
            velocityXKmS: 0,
            velocityYKmS: Math.sqrt(398600.4418 / 7000),
            velocityZKmS: 0
        }
    });

    assert.equal(state.name, "Flat vector");
    assert.deepEqual(state.stateVector.positionEciKm, { x: 7000, y: 0, z: 0 });
    approximately(state.keplerian.semiMajorAxisKm, 7000);
    approximately(state.keplerian.eccentricity, 0, 1e-10);
    approximately(state.keplerian.inclinationDeg, 0, 1e-10);
});

test("synchronization derives the opposite representation and ignores stale geometry on metadata changes", () => {
    let state = createDefaultManualOrbitState({ now: "2026-07-20T10:15:00Z" });
    state = synchronizeManualOrbitState(state, {
        keplerian: { semiMajorAxisKm: 7200, eccentricity: 0.02, inclinationDeg: 35, raanDeg: 20, argumentOfPeriapsisDeg: 15, trueAnomalyDeg: 10 }
    }, "keplerian");
    approximately(state.keplerian.semiMajorAxisKm, 7200);
    assert.notEqual(state.stateVector.positionEciKm.x, 6871.122);

    const vectorBeforeMetadataChange = state.stateVector.positionEciKm.x;
    state = synchronizeManualOrbitState(state, {
        source: "name",
        name: "Renamed manually",
        // A UI form can contain stale values for the other tab; metadata must
        // not use them as a new definition.
        stateVector: { positionXKm: 1, positionYKm: 1, positionZKm: 1, velocityXKmS: 1, velocityYKmS: 1, velocityZKmS: 1 }
    });
    assert.equal(state.name, "Renamed manually");
    approximately(state.stateVector.positionEciKm.x, vectorBeforeMetadataChange);

    state = synchronizeManualOrbitState(state, {
        stateVector: {
            positionEciKm: { x: 7000, y: 0, z: 0 },
            velocityEciKmS: { x: 0, y: Math.sqrt(398600.4418 / 7000), z: 0 }
        }
    }, "state-vector");
    approximately(state.keplerian.semiMajorAxisKm, 7000);
});

test("manual-orbit API serialization preserves the authoritative source and nested ECI contract", () => {
    const state = createDefaultManualOrbitState({ now: "2026-07-20T10:15:00Z" });
    const payload = toManualOrbitApiPayload(state, {
        source: "stateVector",
        horizonHours: 12,
        stepSeconds: 60,
        includeVelocity: true
    });

    assert.equal(payload.epoch, "2026-07-20T10:15:00.000Z");
    assert.equal(payload.definition_source, "state-vector");
    assert.equal(payload.horizon_hours, 12);
    assert.equal(payload.step_seconds, 60);
    assert.equal(payload.include_velocity, true);
    assert.deepEqual(payload.state_vector.position_eci_km, state.stateVector.positionEciKm);
    assert.equal(payload.keplerian.argument_of_perigee_deg, state.keplerian.argumentOfPeriapsisDeg);
});

test("invalid editor definitions fail with the orbital validation error type", () => {
    assert.throws(
        () => normalizeManualOrbitState({
            epochUtc: "not a date",
            keplerian: { semiMajorAxisKm: 7000, eccentricity: 0.1, inclinationDeg: 20, raanDeg: 0, argumentOfPeriapsisDeg: 0, trueAnomalyDeg: 0 }
        }),
        OrbitalElementsValidationError
    );
    assert.throws(
        () => normalizeManualOrbitState({
            stateVector: {
                positionEciKm: { x: 7000, y: 0, z: 0 },
                velocityEciKmS: { x: 11, y: 0, z: 0 }
            },
            source: "state-vector"
        }),
        OrbitalElementsValidationError
    );
});

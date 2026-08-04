import assert from "node:assert/strict";
import test from "node:test";

import {
    createDefaultManualOrbitState,
    normalizeManualOrbitForceTerms,
    normalizeManualOrbitNumericalIntegrator,
    normalizeManualOrbitPropagator,
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
    assert.equal(state.propagator, "two-body");
    assert.deepEqual(state.objectMetadata, {
        objectType: "satellite",
        missionType: "",
        operator: "",
        country: "",
        launchDate: ""
    });
    assert.deepEqual(state.propagationOptions, {
        atmosphericDrag: false,
        dragCoefficient: 2.2,
        areaM2: 1,
        massKg: 100,
        forceTerms: ["central"],
        cowellGravityModel: "two-body",
        numericalIntegrator: "rk4"
    });
    assert.equal(state.keplerian.semiMajorAxisKm, 6878);
    assert.equal(state.stateVector.positionEciKm.x, 6871.122);
    assert.ok(Math.hypot(
        state.stateVector.velocityEciKmS.x,
        state.stateVector.velocityEciKmS.y,
        state.stateVector.velocityEciKmS.z
    ) > 7.6);
    assert.equal("positionXKm" in state.stateVector, false);
});

test("manual propagator aliases are canonicalized while future names remain serializable", () => {
    assert.equal(normalizeManualOrbitPropagator("kepler"), "two-body");
    assert.equal(normalizeManualOrbitPropagator("two_body"), "two-body");
    assert.equal(normalizeManualOrbitPropagator(" J2 secular "), "j2");
    assert.equal(normalizeManualOrbitPropagator("j2_analytic"), "j2");
    assert.equal(normalizeManualOrbitPropagator("J2 + J3 + J4"), "j2-j3-j4");
    assert.equal(normalizeManualOrbitPropagator("j2_j3_j4"), "j2-j3-j4");
    assert.equal(normalizeManualOrbitPropagator("Cowell / RK4"), "cowell-rk4");
    assert.equal(normalizeManualOrbitPropagator("SGP-4"), "sgp4");
    assert.equal(normalizeManualOrbitPropagator("future-model"), "future-model");

    const current = createDefaultManualOrbitState({ now: "2026-07-20T10:15:00Z" });
    const updated = synchronizeManualOrbitState(current, { propagator: "kepler" }, "propagator");
    assert.equal(updated.propagator, "two-body");
    assert.deepEqual(updated.stateVector, current.stateVector);
    assert.equal(toManualOrbitApiPayload(updated).propagator, "two-body");
});

test("Cowell's numerical integrator is normalized separately from its force model", () => {
    assert.equal(normalizeManualOrbitNumericalIntegrator("RK-4"), "rk4");
    assert.equal(normalizeManualOrbitNumericalIntegrator("Runge Kutta 4"), "rk4");
    assert.equal(normalizeManualOrbitNumericalIntegrator("future-integrator"), "future-integrator");

    const state = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagation_options: {
            numerical_integrator: "runge-kutta-4",
            cowell_gravity_model: "j2-j3-j4"
        }
    });
    assert.equal(state.propagator, "cowell-rk4");
    assert.equal(state.propagationOptions.cowellGravityModel, "j2-j3-j4");
    assert.equal(state.propagationOptions.numericalIntegrator, "rk4");
});

test("force terms are authoritative, ordered, and derive legacy compatibility aliases", () => {
    assert.deepEqual(
        normalizeManualOrbitForceTerms(["drag", "J4", "central", "j2", "j2"]),
        ["central", "j2", "j4", "drag"]
    );
    assert.deepEqual(normalizeManualOrbitForceTerms([]), ["central"]);

    const state = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagation_options: {
            force_terms: ["drag", "j4", "j2"],
            // The new array wins over these stale legacy aliases.
            atmospheric_drag: false,
            force_model: "two-body"
        }
    });
    assert.deepEqual(state.propagationOptions.forceTerms, ["central", "j2", "j4", "drag"]);
    assert.equal(state.propagationOptions.atmosphericDrag, true);
    assert.equal(state.propagationOptions.cowellGravityModel, null);
    const customPayload = toManualOrbitApiPayload(state);
    assert.deepEqual(customPayload.propagation_options.force_terms, ["central", "j2", "j4", "drag"]);
    assert.equal("cowell_gravity_model" in customPayload.propagation_options, false);

    const legacy = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { forceModel: "j2", atmosphericDrag: true }
    });
    assert.deepEqual(legacy.propagationOptions.forceTerms, ["central", "j2", "drag"]);
    assert.equal(legacy.propagationOptions.cowellGravityModel, "j2");

    const gravityAlias = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { gravityTerms: ["j3"] }
    });
    assert.deepEqual(gravityAlias.propagationOptions.forceTerms, ["central", "j3"]);
    assert.equal(gravityAlias.propagationOptions.cowellGravityModel, null);

    const futureForce = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { forceTerms: ["central", "j2", "srp"] }
    });
    assert.deepEqual(futureForce.propagationOptions.forceTerms, ["central", "j2", "srp"]);
    assert.equal(futureForce.propagationOptions.cowellGravityModel, null);
    assert.equal("cowell_gravity_model" in toManualOrbitApiPayload(futureForce).propagation_options, false);

    const legacyPreset = normalizeManualOrbitState({
        propagator: "j2",
        propagationOptions: { forceTerms: ["central", "j3", "drag"] }
    });
    assert.equal(legacyPreset.propagator, "j2");
    assert.deepEqual(legacyPreset.propagationOptions.forceTerms, ["central", "j2"]);
    assert.equal(legacyPreset.propagationOptions.atmosphericDrag, false);

    for (const propagator of ["two-body", "sgp4"]) {
        const fixedEngine = normalizeManualOrbitState({
            propagator,
            propagationOptions: { forceTerms: ["central", "j2", "j3", "j4", "drag"] }
        });
        assert.deepEqual(fixedEngine.propagationOptions.forceTerms, ["central"]);
        assert.equal(fixedEngine.propagationOptions.cowellGravityModel, "two-body");
        assert.equal(fixedEngine.propagationOptions.atmosphericDrag, false);
    }
});

test("independent atmospheric drag is retained only by the explicit Cowell/RK4 path", () => {
    const zonal = normalizeManualOrbitState({
        propagator: "j2-j3-j4",
        propagationOptions: { atmosphericDrag: true }
    });
    assert.equal(zonal.propagationOptions.atmosphericDrag, false);
    assert.deepEqual(zonal.propagationOptions.forceTerms, ["central", "j2", "j3", "j4"]);

    const cowell = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: {
            atmosphericDrag: true,
            cowellGravityModel: "j2"
        }
    });
    assert.equal(cowell.propagationOptions.atmosphericDrag, true);
    assert.equal(cowell.propagationOptions.cowellGravityModel, "j2");
    assert.equal(cowell.propagationOptions.numericalIntegrator, "rk4");
    assert.deepEqual(cowell.propagationOptions.forceTerms, ["central", "j2", "drag"]);
});

test("legacy Cowell drag options recover their historical gravity preset without changing clean defaults", () => {
    const clean = normalizeManualOrbitState({ propagator: "cowell-rk4" });
    assert.deepEqual(clean.propagationOptions.forceTerms, ["central"]);
    assert.equal(clean.propagationOptions.cowellGravityModel, "two-body");

    const legacyDragOnly = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { atmospheric_drag: true }
    });
    assert.deepEqual(legacyDragOnly.propagationOptions.forceTerms, ["central", "j2", "j3", "j4", "drag"]);
    assert.equal(legacyDragOnly.propagationOptions.cowellGravityModel, "j2-j3-j4");

    const legacyDragConfiguration = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { drag_coefficient: 3.1, area_m2: 2.5, mass_kg: 180 }
    });
    assert.deepEqual(legacyDragConfiguration.propagationOptions.forceTerms, ["central", "j2", "j3", "j4"]);
    assert.equal(legacyDragConfiguration.propagationOptions.cowellGravityModel, "j2-j3-j4");

    const legacyIntegratorOnly = normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { numericalIntegrator: "rk4" }
    });
    assert.deepEqual(legacyIntegratorOnly.propagationOptions.forceTerms, ["central", "j2", "j3", "j4"]);
    assert.equal(legacyIntegratorOnly.propagationOptions.cowellGravityModel, "j2-j3-j4");
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
        object_metadata: {
            object_type: "satellite",
            mission_type: "Earth observation",
            operator: "Orbit Labs",
            country: "ES",
            launch_date: "2026-07-20"
        }
    }, "object-metadata");
    assert.equal(state.objectMetadata.operator, "Orbit Labs");
    assert.equal(state.objectMetadata.launchDate, "2026-07-20");
    approximately(state.stateVector.positionEciKm.x, vectorBeforeMetadataChange);

    state = synchronizeManualOrbitState(state, {
        propagator: "cowell-rk4",
        propagation_options: {
            atmospheric_drag: true,
            drag_coefficient: 2.35,
            area_m2: 3.4,
            mass_kg: 420,
            cowell_gravity_model: "j2",
            numerical_integrator: "rk-4"
        }
    }, "propagation-options");
    assert.deepEqual(state.propagationOptions, {
        atmosphericDrag: true,
        dragCoefficient: 2.35,
        areaM2: 3.4,
        massKg: 420,
        forceTerms: ["central", "j2", "drag"],
        cowellGravityModel: "j2",
        numericalIntegrator: "rk4"
    });
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
    assert.deepEqual(payload.object_metadata, {
        object_type: "satellite",
        mission_type: "",
        operator: "",
        country: "",
        launch_date: ""
    });
    assert.deepEqual(payload.propagation_options, {
        atmospheric_drag: false,
        drag_coefficient: 2.2,
        area_m2: 1,
        mass_kg: 100,
        force_terms: ["central"]
    });

    const cowellPayload = toManualOrbitApiPayload(normalizeManualOrbitState({
        propagator: "cowell-rk4",
        propagationOptions: { forceTerms: ["central", "j2"], numericalIntegrator: "rk4" }
    }));
    assert.equal(cowellPayload.propagation_options.numerical_integrator, "rk4");
});

test("manual-orbit state accepts snake-case API responses without losing authored metadata", () => {
    const state = normalizeManualOrbitState({
        name: "Response-compatible object",
        epoch: "2026-07-20T10:15:00Z",
        propagator: "cowell-rk4",
        definition_source: "keplerian",
        object_metadata: {
            object_type: "rocket body",
            mission_type: "launch support",
            operator: "Example operator",
            country: "US",
            launch_date: "2025-03-08"
        },
        propagation_options: {
            atmospheric_drag: "true",
            drag_coefficient: 1.9,
            area_m2: 4.5,
            mass_kg: 820,
            force_terms: ["central", "j2", "j3", "j4", "drag"],
            cowell_gravity_model: "j2-j3-j4",
            numerical_integrator: "rk4"
        },
        keplerian: {
            semi_major_axis_km: 7200,
            eccentricity: 0.02,
            inclination_deg: 35,
            raan_deg: 20,
            argument_of_perigee_deg: 15,
            true_anomaly_deg: 10
        }
    });

    assert.equal(state.propagator, "cowell-rk4");
    assert.deepEqual(state.objectMetadata, {
        objectType: "rocket body",
        missionType: "launch support",
        operator: "Example operator",
        country: "US",
        launchDate: "2025-03-08"
    });
    assert.deepEqual(state.propagationOptions, {
        atmosphericDrag: true,
        dragCoefficient: 1.9,
        areaM2: 4.5,
        massKg: 820,
        forceTerms: ["central", "j2", "j3", "j4", "drag"],
        cowellGravityModel: "j2-j3-j4",
        numericalIntegrator: "rk4"
    });

    const camelCaseResponse = normalizeManualOrbitState({
        objectMetadata: {
            missionType: "communications",
            operator: "CamelCase operator"
        },
        propagationOptions: {
            atmosphericDrag: false,
            dragCoefficient: 2.6,
            areaM2: 2,
            massKg: 250,
            cowellGravityModel: "two-body",
            numericalIntegrator: "rk-4"
        }
    });
    assert.equal(camelCaseResponse.objectMetadata.missionType, "communications");
    assert.equal(camelCaseResponse.objectMetadata.operator, "CamelCase operator");
    assert.equal(camelCaseResponse.propagationOptions.dragCoefficient, 2.6);
    assert.equal(camelCaseResponse.propagationOptions.atmosphericDrag, false);
    assert.equal(camelCaseResponse.propagationOptions.cowellGravityModel, "two-body");
    assert.equal(camelCaseResponse.propagationOptions.numericalIntegrator, "rk4");
    assert.deepEqual(camelCaseResponse.propagationOptions.forceTerms, ["central"]);
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

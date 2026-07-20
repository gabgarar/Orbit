import assert from "node:assert/strict";
import test from "node:test";

import {
    OrbitalElementsValidationError,
    WGS84_EARTH_MU_KM3_S2,
    keplerianToStateVector,
    meanAnomalyToTrueAnomalyDeg,
    stateVectorToKeplerian,
    trueAnomalyToMeanAnomalyDeg
} from "../../js/features/manualOrbit/orbitalElements.js";

function approximately(actual, expected, tolerance = 1e-8) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `Expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

function angleApproximately(actual, expected, tolerance = 1e-8) {
    const difference = ((actual - expected + 540) % 360) - 180;
    approximately(difference, 0, tolerance);
}

test("converts a circular equatorial Keplerian orbit to explicit ECI km and km/s", () => {
    const state = keplerianToStateVector({
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 0,
        raanDeg: 0,
        argumentOfPeriapsisDeg: 0,
        trueAnomalyDeg: 0
    });

    approximately(state.positionEciKm.x, 7000, 1e-10);
    approximately(state.positionEciKm.y, 0, 1e-10);
    approximately(state.positionEciKm.z, 0, 1e-10);
    approximately(state.velocityEciKmS.x, 0, 1e-10);
    approximately(state.velocityEciKmS.y, Math.sqrt(WGS84_EARTH_MU_KM3_S2 / 7000), 1e-12);
    approximately(state.velocityEciKmS.z, 0, 1e-10);
    approximately(state.orbitalPeriodSeconds, 5828.5166, 0.01);
});

test("round-trips a non-singular elliptic orbit without changing its geometry", () => {
    const elements = {
        semiMajorAxisKm: 12000,
        eccentricity: 0.25,
        inclinationDeg: 48.5,
        raanDeg: 125.25,
        argumentOfPeriapsisDeg: 62.75,
        trueAnomalyDeg: 231.5
    };

    const recovered = stateVectorToKeplerian(keplerianToStateVector(elements));

    approximately(recovered.semiMajorAxisKm, elements.semiMajorAxisKm, 1e-8);
    approximately(recovered.eccentricity, elements.eccentricity, 1e-11);
    approximately(recovered.inclinationDeg, elements.inclinationDeg, 1e-9);
    angleApproximately(recovered.raanDeg, elements.raanDeg, 1e-9);
    angleApproximately(recovered.argumentOfPeriapsisDeg, elements.argumentOfPeriapsisDeg, 1e-9);
    angleApproximately(recovered.trueAnomalyDeg, elements.trueAnomalyDeg, 1e-9);
});

test("accepts mean anomaly and reports a matching true anomaly for elliptic inputs", () => {
    const eccentricity = 0.1;
    const trueAnomalyDeg = meanAnomalyToTrueAnomalyDeg(90, eccentricity);
    const meanAnomalyDeg = trueAnomalyToMeanAnomalyDeg(trueAnomalyDeg, eccentricity);
    const state = keplerianToStateVector({
        semiMajorAxisKm: 8000,
        eccentricity,
        inclinationDeg: 20,
        raanDeg: 30,
        argumentOfPeriapsisDeg: 40,
        meanAnomalyDeg: 90
    });

    approximately(trueAnomalyDeg, 101.3838146, 1e-6);
    angleApproximately(meanAnomalyDeg, 90, 1e-9);
    angleApproximately(state.trueAnomalyDeg, trueAnomalyDeg, 1e-9);
    angleApproximately(state.meanAnomalyDeg, 90, 1e-9);
});

test("derives classical elements from a published non-circular ECI state-vector example", () => {
    const elements = stateVectorToKeplerian({
        positionEciKm: { x: 6524.834, y: 6862.875, z: 6448.296 },
        velocityEciKmS: { x: 4.901327, y: 5.533756, z: -1.976341 }
    });

    approximately(elements.semiMajorAxisKm, 36127.34, 0.1);
    approximately(elements.eccentricity, 0.83285, 0.00001);
    approximately(elements.inclinationDeg, 87.87, 0.01);
    angleApproximately(elements.raanDeg, 227.89, 0.01);
    angleApproximately(elements.argumentOfPeriapsisDeg, 53.38, 0.02);
    angleApproximately(elements.trueAnomalyDeg, 92.335, 0.02);
});

test("uses a stable canonical representation for circular equatorial states", () => {
    const state = keplerianToStateVector({
        semiMajorAxisKm: 7000,
        eccentricity: 0,
        inclinationDeg: 0,
        raanDeg: 0,
        argumentOfPeriapsisDeg: 0,
        trueAnomalyDeg: 275
    });
    const recovered = stateVectorToKeplerian(state);

    assert.equal(recovered.anomalyReference, "true-longitude");
    approximately(recovered.eccentricity, 0, 1e-12);
    angleApproximately(recovered.raanDeg, 0);
    angleApproximately(recovered.argumentOfPeriapsisDeg, 0);
    angleApproximately(recovered.trueAnomalyDeg, 275, 1e-9);
});

test("rejects invalid and non-elliptic manual-orbit values instead of fabricating a state", () => {
    const base = {
        semiMajorAxisKm: 7000,
        eccentricity: 0.1,
        inclinationDeg: 20,
        raanDeg: 30,
        argumentOfPeriapsisDeg: 40,
        trueAnomalyDeg: 50
    };

    assert.throws(
        () => keplerianToStateVector({ ...base, eccentricity: 1 }),
        OrbitalElementsValidationError
    );
    assert.throws(
        () => keplerianToStateVector({ ...base, trueAnomalyDeg: 50, meanAnomalyDeg: 45 }),
        OrbitalElementsValidationError
    );
    assert.throws(
        () => stateVectorToKeplerian({
            positionEciKm: { x: 7000, y: 0, z: 0 },
            velocityEciKmS: { x: 11, y: 0, z: 0 }
        }),
        OrbitalElementsValidationError
    );
});

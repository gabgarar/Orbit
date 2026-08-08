import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultManualOrbitState } from "../../js/features/manualOrbit/editorState.js";
import {
    ManualAosLosRequestError,
    buildManualAosLosRequest,
    manualAosLosSignature,
    resolveManualAosLosWindow
} from "../../js/features/groundStations/manualAosLos.js";

function manualOrbit(overrides = {}) {
    return {
        ...createDefaultManualOrbitState({ now: "2026-08-08T10:00:00Z" }),
        startTime: "2026-08-08T10:00:00Z",
        endTime: "2026-08-08T14:00:00Z",
        definitionSource: "state_vector",
        ...overrides
    };
}

const station = {
    lat_deg: 40.4168,
    lon_deg: -3.7038,
    height_m: 667,
    min_elevation_deg: 10
};

test("manual AOS/LOS uses the exact authored design window", () => {
    const window = resolveManualAosLosWindow(manualOrbit());

    assert.equal(window.source, "manual-design");
    assert.equal(window.startDate.toISOString(), "2026-08-08T10:00:00.000Z");
    assert.equal(window.endDate.toISOString(), "2026-08-08T14:00:00.000Z");
});

test("manual AOS/LOS POST body carries the native manual propagator", () => {
    const request = buildManualAosLosRequest({
        manualOrbit: manualOrbit({ propagator: "cowell-rk4" }),
        station,
        stepSeconds: 20,
        includeSamples: true,
        chartPaddingSeconds: 120
    });

    assert.equal(request.body.source.kind, "manual");
    assert.equal(request.body.source.manualOrbit.propagator, "cowell-rk4");
    // Keep the editor serializer's public spelling; the Python request model
    // accepts it as the `state_vector` definition alias.
    assert.equal(request.body.source.manualOrbit.definition_source, "state-vector");
    assert.equal(request.body.source.manualOrbit.start_time, "2026-08-08T10:00:00.000Z");
    assert.equal(request.body.source.manualOrbit.end_time, "2026-08-08T14:00:00.000Z");
    assert.equal(request.body.source.manualOrbit.include_velocity, false);
    assert.equal("sat_id" in request.body, false);
    assert.deepEqual(request.body.station, station);
    assert.equal(request.body.start_time, "2026-08-08T10:00:00.000Z");
    assert.equal(request.body.end_time, "2026-08-08T14:00:00.000Z");
    assert.equal(request.body.step_seconds, 20);
    assert.equal(request.body.include_samples, true);
    assert.equal(request.body.chart_padding_seconds, 120);
});

test("manual AOS/LOS leaves optional chart padding absent when it is not requested", () => {
    const request = buildManualAosLosRequest({
        manualOrbit: manualOrbit(),
        station,
        stepSeconds: 30,
        includeSamples: false
    });

    assert.equal("chart_padding_seconds" in request.body, false);
    assert.equal(request.body.include_samples, false);
});

test("manual AOS/LOS rejects a missing or inverted design interval", () => {
    assert.throws(
        () => resolveManualAosLosWindow(manualOrbit({ endTime: "2026-08-08T09:59:59Z" })),
        ManualAosLosRequestError
    );
    assert.throws(
        () => resolveManualAosLosWindow(manualOrbit({ startTime: null, endTime: null })),
        /ventana de diseño válida/
    );
});

test("manual AOS/LOS signature changes when the authored interval changes", () => {
    const initial = manualOrbit();
    const revised = manualOrbit({ endTime: "2026-08-08T16:00:00Z" });

    assert.notEqual(manualAosLosSignature(initial), manualAosLosSignature(revised));
});

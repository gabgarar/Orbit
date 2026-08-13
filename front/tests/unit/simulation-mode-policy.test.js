import assert from "node:assert/strict";
import test from "node:test";

import { resolveSimulationModeRequest } from "../../js/runtime/simulation/modePolicy.js";

for (const [label, domains] of [
    ["OEM", { hasOemDomain: true }],
    ["SP3", { hasSp3Domain: true }],
    ["orbita manual", { hasManualDomain: true }],
    ["OEM y SP3", { hasOemDomain: true, hasSp3Domain: true }]
]) {
    test(`${label} finito fuerza Rango cuando se solicita Real time`, () => {
        const result = resolveSimulationModeRequest("realtime", domains);

        assert.equal(result.mode, "range");
        assert.equal(result.requestedMode, "realtime");
        assert.equal(result.restricted, true);
        assert.equal(result.reason, "finite-ephemeris-domain");
    });

    test(`${label} finito fuerza Rango cuando se solicita Static`, () => {
        const result = resolveSimulationModeRequest("static", domains);

        assert.equal(result.mode, "range");
        assert.equal(result.requestedMode, "static");
        assert.equal(result.restricted, true);
        assert.equal(result.reason, "finite-ephemeris-domain");
    });

    test(`${label} finito conserva Rango como único modo temporal válido`, () => {
        const result = resolveSimulationModeRequest("range", domains);

        assert.equal(result.mode, "range");
        assert.equal(result.restricted, false);
    });
}

test("TLE sin dominio finito conserva Real time y Static", () => {
    const tleDomains = { hasOemDomain: false, hasSp3Domain: false };
    const realtime = resolveSimulationModeRequest("realtime", tleDomains);
    const staticMode = resolveSimulationModeRequest("static", tleDomains);

    assert.deepEqual(realtime, {
        mode: "realtime",
        requestedMode: "realtime",
        restricted: false,
        reason: null,
        finiteSources: []
    });
    assert.deepEqual(staticMode, {
        mode: "static",
        requestedMode: "static",
        restricted: false,
        reason: null,
        finiteSources: []
    });
});

test("un modo inválido se normaliza y sigue bloqueado si hay una efeméride finita", () => {
    const result = resolveSimulationModeRequest("unexpected", { hasSp3Domain: true });

    assert.equal(result.requestedMode, "realtime");
    assert.equal(result.mode, "range");
    assert.equal(result.restricted, true);
    assert.deepEqual(result.finiteSources, ["SP3"]);
});

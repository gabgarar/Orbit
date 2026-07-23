import assert from "node:assert/strict";
import test from "node:test";

import { getOrbitInfoFromTelemetry } from "../../js/objectSidebar.js";

test("telemetry orbit fallback returns a detail payload without a catalogue mission helper", () => {
    assert.doesNotThrow(() => getOrbitInfoFromTelemetry({
        geo: { altitude_m: 550_000 }
    }));

    const orbit = getOrbitInfoFromTelemetry({
        geo: { altitude_m: 550_000 }
    });

    assert.equal(orbit.kind, "leo");
    assert.equal(orbit.label, "LEO");
    assert.equal(orbit.recommendedWindow, "1-3 dias");
    assert.equal("mission" in orbit, false);
});

test("telemetry orbit fallback remains safe when geographic telemetry is absent", () => {
    const orbit = getOrbitInfoFromTelemetry(null);

    assert.equal(orbit.kind, "unknown");
    assert.equal(orbit.altitudeKm, null);
    assert.equal(orbit.recommendedWindow, "Sin referencia");
});

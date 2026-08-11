import assert from "node:assert/strict";
import test from "node:test";

import { buildInfoText, getOrbitInfoFromTelemetry } from "../../js/objectSidebar.js";

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

test("celestial telemetry remains renderable when it has no velocity vector", () => {
    const html = buildInfoText({
        id: "Moon",
        source_format: "CELESTIAL",
        celestial_body: "moon",
        geo: {}
    });

    assert.match(html, /Velocidad X/);
    assert.match(html, />-<\/span>/);
});

test("legacy information fallback renders SP3 as a GNSS product, never as a TLE", () => {
    const html = buildInfoText({
        id: "precise:product:C06",
        source_format: "SP3",
        timestamp_ms: Date.parse("2026-08-10T01:00:00Z"),
        position_frame_display: "ITRF (con ERP aplicado)",
        position: { x: 21_000_000, y: -13_000_000, z: 9_000_000 },
        velocity: { x: -1550, y: 2950, z: 2100 },
        speed_m_s: 3925,
        sp3: {
            satellite_id: "C06",
            product_id: "precise-product",
            provider: "igs_mgex",
            product_class: "final",
            file_name: "COD0MGXFIN_ORB.SP3.gz",
            native_reference_frame: "IGB20",
            time_system: "GPS",
            start_time: "2026-08-10T00:00:00Z",
            end_time: "2026-08-10T23:55:00Z",
            sample_count: 288,
            sample_cadence_seconds: 300,
            interpolation: { method: "LAGRANGE", degree: 9 },
            rendering: { available: true, display_label: "ITRF (con ERP aplicado)" }
        },
        renderer_reference: { available: true, display_label: "ITRF (con ERP aplicado)" }
    });

    assert.match(html, /Producto GNSS/);
    assert.match(html, /BeiDou/);
    assert.match(html, /LAGRANGE/);
    assert.doesNotMatch(html, /Edad TLE/);
    assert.doesNotMatch(html, /Propagacion futura/);
    assert.doesNotMatch(html, /Tipo de fuente[^<]*<\/span>\s*<span[^>]*>TLE/);
});

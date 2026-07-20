import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSystemConfig, toSectionedSystemConfig } from "../../js/configAdapter.js";

test("retired trail settings are ignored by the runtime configuration adapter", () => {
    const normalized = normalizeSystemConfig({
        orbit: {
            trail_show: false,
            trail_color: "#123456",
            trail_speed_seconds: 9,
            trail_length_percent: 12,
            trail_line_width: 4,
            past_show: false
        },
        orbit_trail_show: false
    });

    const sectioned = toSectionedSystemConfig({
        orbit: {
            trail_show: true,
            trail_speed_seconds: 9,
            trail_length_percent: 12,
            trail_line_width: 4,
            trail_color: "#123456"
        }
    });

    for (const key of [
        "orbit_trail_show",
        "orbit_trail_color",
        "orbit_trail_speed_seconds",
        "orbit_trail_length_percent",
        "orbit_trail_line_width"
    ]) {
        assert.equal(key in normalized, false);
    }
    for (const key of ["trail_show", "trail_color", "trail_speed_seconds", "trail_length_percent", "trail_line_width"]) {
        assert.equal(key in sectioned.orbit, false);
    }
});

test("retired active-layer limits are omitted from normalized configuration", () => {
    const sectioned = toSectionedSystemConfig({
        max_satellites_visible: 100,
        satellite_label_size_px: 12
    });

    assert.equal("max_visible" in sectioned.satellites, false);
    assert.equal(sectioned.satellites.label_size_px, 12);
});

test("retired orbit width modes are ignored while preserving the fixed visual width", () => {
    const normalized = normalizeSystemConfig({
        orbit: { width_mode: "physical" },
        orbit_width_mode: "physical"
    });
    const sectioned = toSectionedSystemConfig({
        orbit: { width_mode: "physical" },
        orbit_width_mode: "physical"
    });

    assert.equal("orbit_width_mode" in normalized, false);
    assert.equal("width_mode" in sectioned.orbit, false);
    assert.equal(sectioned.orbit.future_line_width, 2.5);
});

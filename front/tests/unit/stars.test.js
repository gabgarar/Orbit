import assert from "node:assert/strict";
import test from "node:test";

import { applyStarsConfig } from "../../js/rendering/stars.js";

function createTrackedVisibility(initialValue) {
    let currentValue = initialValue;
    let writes = 0;
    return {
        get show() {
            return currentValue;
        },
        set show(nextValue) {
            writes += 1;
            currentValue = nextValue;
        },
        get writes() {
            return writes;
        }
    };
}

test("disabling stars only releases the Tycho background and preserves celestial surfaces", () => {
    const nativeSun = createTrackedVisibility(true);
    const nativeMoon = createTrackedVisibility(true);
    const moonSurface = {
        show: true,
        material: { type: "Image", uniforms: { image: "/assets/basemap/Moon_color_16bit_srgb_4k.png" } }
    };
    const solarSurface = { show: true, material: { fabric: { type: "OrbitSolarEmission" } } };
    const viewer = {
        scene: {
            skyBox: { legacy: true },
            sun: nativeSun,
            moon: nativeMoon,
            physicalBodies: [moonSurface, solarSurface],
            renderRequests: 0,
            requestRender() { this.renderRequests += 1; }
        }
    };
    const skyDome = {
        ensures: 0,
        releases: 0,
        ensure() { this.ensures += 1; },
        release() { this.releases += 1; }
    };
    const black = { css: "black" };

    assert.equal(applyStarsConfig({
        viewer,
        Cesium: { Color: { BLACK: black } },
        skyDome,
        systemConfig: { stars_enabled: false }
    }), false);

    assert.equal(skyDome.releases, 1);
    assert.equal(skyDome.ensures, 0);
    assert.equal(viewer.scene.skyBox, undefined);
    assert.equal(viewer.scene.backgroundColor, black);
    assert.equal(viewer.scene.renderRequests, 1);

    // Native bodies are a fallback managed by celestialLayers, while these
    // custom primitives own the textured physical rendering.  The star
    // toggle must not alter either path.
    assert.equal(nativeSun.show, true);
    assert.equal(nativeMoon.show, true);
    assert.equal(nativeSun.writes, 0);
    assert.equal(nativeMoon.writes, 0);
    assert.equal(moonSurface.show, true);
    assert.equal(moonSurface.material.uniforms.image, "/assets/basemap/Moon_color_16bit_srgb_4k.png");
    assert.equal(solarSurface.show, true);

    assert.equal(applyStarsConfig({
        viewer,
        Cesium: { Color: { BLACK: black } },
        skyDome,
        systemConfig: { stars_enabled: true }
    }), true);
    assert.equal(skyDome.ensures, 1);
    assert.equal(skyDome.releases, 1);
    assert.equal(nativeSun.writes, 0);
    assert.equal(nativeMoon.writes, 0);
    assert.equal(moonSurface.show, true);
    assert.equal(solarSurface.show, true);
    assert.equal(viewer.scene.renderRequests, 2);
});

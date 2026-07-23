import assert from "node:assert/strict";
import test from "node:test";

import { createTychoSkyDome, getTychoSkyDomeRenderState } from "../../js/rendering/tychoSkyDome.js";

test("Tycho sky dome preserves depth for physical bodies without writing a background depth", () => {
    const renderState = getTychoSkyDomeRenderState();

    assert.equal(renderState.depthTest.enabled, true);
    assert.equal(renderState.depthMask, false);
});

test("Tycho primitive receives the background-safe depth state", () => {
    let appearanceOptions = null;
    const primitives = [];
    const listeners = [];
    const Cesium = {
        Material: { fromType: (_type, options) => ({ options }) },
        Cartesian2: class Cartesian2 {
            constructor(x, y) {
                this.x = x;
                this.y = y;
            }
        },
        Primitive: class Primitive {
            constructor(options) {
                Object.assign(this, options);
            }
        },
        GeometryInstance: class GeometryInstance {
            constructor(options) {
                Object.assign(this, options);
            }
        },
        SphereGeometry: class SphereGeometry {
            constructor(options) {
                Object.assign(this, options);
            }
        },
        VertexFormat: { POSITION_AND_ST: "position-and-st" },
        MaterialAppearance: class MaterialAppearance {
            constructor(options) {
                appearanceOptions = options;
            }
        },
        Matrix4: {
            fromTranslation: (position) => ({ translation: position })
        }
    };
    const viewer = {
        camera: { positionWC: { x: 1, y: 2, z: 3 } },
        scene: {
            primitives: {
                add: (primitive) => {
                    primitives.push(primitive);
                    return primitive;
                },
                remove: (primitive) => {
                    const index = primitives.indexOf(primitive);
                    if (index >= 0) primitives.splice(index, 1);
                    return index >= 0;
                }
            },
            preRender: {
                addEventListener: (listener) => listeners.push(listener),
                removeEventListener: (listener) => {
                    const index = listeners.indexOf(listener);
                    if (index >= 0) listeners.splice(index, 1);
                }
            }
        }
    };

    const dome = createTychoSkyDome({ viewer, Cesium, textureUrl: "assets/stars.jpg" });
    dome.ensure();

    assert.equal(primitives.length, 1);
    assert.equal(appearanceOptions.translucent, false);
    assert.equal(appearanceOptions.renderState.depthTest.enabled, true);
    assert.equal(appearanceOptions.renderState.depthMask, false);
});

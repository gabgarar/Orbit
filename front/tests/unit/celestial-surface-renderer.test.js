import assert from "node:assert/strict";
import test from "node:test";

import {
    MOON_TEXTURE_URL,
    computeMoonModelMatrix,
    createCelestialSurfaceRenderer,
    getRequiredCelestialFrustumFar
} from "../../js/rendering/celestialSurfaceRenderer.js";

class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

class Matrix3 {
    constructor() {
        this.tag = "matrix3";
    }
}

class Matrix4 {
    constructor() {
        this.tag = "matrix4";
    }
}

class EllipsoidPrimitive {
    constructor(options) {
        Object.assign(this, options);
        this.destroyed = false;
    }

    isDestroyed() {
        return this.destroyed;
    }

    destroy() {
        this.destroyed = true;
    }
}

class IauOrientationAxes {
    constructor(compute) {
        this.compute = compute;
    }

    evaluate(time, result) {
        result.orientationFor = time.id;
        return result;
    }
}

function Material(options) {
    Object.assign(this, options);
    this.type = options?.fabric?.type;
    this.uniforms = { ...(options?.fabric?.uniforms || {}) };
}

Material.fromType = (type, uniforms) => ({ type, uniforms });

function createCesiumStub() {
    return {
        Cartesian2: class Cartesian2 {
            constructor(x, y) { this.x = x; this.y = y; }
        },
        Cartesian3,
        Matrix3,
        Matrix4,
        EllipsoidPrimitive,
        Material,
        TextureMinificationFilter: { LINEAR_MIPMAP_LINEAR: "linear-mipmap-linear" },
        TextureMagnificationFilter: { LINEAR: "linear" },
        IauOrientationAxes,
        Iau2000Orientation: { ComputeMoon: () => ({}) },
        Color: {
            fromCssColorString: () => ({ red: 1, green: 0.9, blue: 0.64, alpha: 1 })
        },
        Transforms: {
            computeIcrfToFixedMatrix: (time, result) => Object.assign(result, { offset: time.offset })
        },
        Simon1994PlanetaryPositions: {
            computeMoonPositionInEarthInertialFrame: (_time, result) => Object.assign(result, { x: 1, y: 2, z: 3 })
        }
    };
}

Matrix3.transpose = (matrix, result) => Object.assign(result, matrix, { transposed: true });
Matrix3.multiply = (fixed, axes, result) => Object.assign(result, axes, { fixedOffset: fixed.offset });
Matrix3.multiplyByVector = (fixed, vector, result) => Object.assign(result, {
    x: vector.x + fixed.offset,
    y: vector.y + fixed.offset,
    z: vector.z + fixed.offset
});
Cartesian3.distance = (left, right) => Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z
);
Matrix4.fromRotationTranslation = (rotation, translation, result) => Object.assign(result, { rotation, translation });
Matrix4.fromTranslation = (translation, result) => Object.assign(result, { translation });

function createViewer(time = { id: "now", offset: 7 }) {
    const primitives = [];
    const listeners = new Set();
    return {
        clock: { currentTime: time },
        camera: {
            positionWC: new Cartesian3(0, 0, 0),
            frustum: { far: 500_000_000 }
        },
        scene: {
            renderRequests: 0,
            requestRender() { this.renderRequests += 1; },
            primitives: {
                values: primitives,
                add: (primitive) => { primitives.push(primitive); return primitive; },
                remove: (primitive) => {
                    const index = primitives.indexOf(primitive);
                    if (index >= 0) primitives.splice(index, 1);
                    return index >= 0;
                },
                raiseToTop: (primitive) => {
                    const index = primitives.indexOf(primitive);
                    if (index >= 0) primitives.push(primitives.splice(index, 1)[0]);
                }
            },
            preRender: {
                addEventListener(listener) { listeners.add(listener); },
                removeEventListener(listener) { listeners.delete(listener); },
                raise(timeAtFrame) { [...listeners].forEach((listener) => listener(this, timeAtFrame)); }
            }
        }
    };
}

test("Moon model matrix uses Cesium's IAU axes and the exact clock transform", () => {
    const Cesium = createCesiumStub();
    const time = { id: "frame-1", offset: 12 };
    const matrix = computeMoonModelMatrix({ Cesium, time });

    assert.equal(matrix.rotation.orientationFor, "frame-1");
    assert.equal(matrix.rotation.transposed, true);
    assert.equal(matrix.rotation.fixedOffset, 12);
    assert.deepEqual(matrix.translation, new Cartesian3(13, 14, 15));
});

test("physical Sun framing expands Cesium's far plane without display-scale shortcuts", () => {
    const Cesium = createCesiumStub();
    const far = getRequiredCelestialFrustumFar({
        Cesium,
        cameraPosition: new Cartesian3(0, 0, 0),
        bodyPosition: new Cartesian3(149_597_870_700, 0, 0),
        radiusMeters: 695_700_000
    });

    assert.equal(far > 150_000_000_000, true);
    assert.equal(far < 160_000_000_000, true);
});

test("Moon surface uses a solar-lit albedo material with a faint night-side floor", () => {
    const Cesium = createCesiumStub();
    const viewer = createViewer();
    const anchor = { id: "body:moon" };
    const renderer = createCelestialSurfaceRenderer({
        kind: "moon",
        viewer,
        Cesium,
        radiusMeters: 1_737_400,
        getPosition: (_time, result) => Object.assign(result, { x: 10, y: 20, z: 30 })
    });

    renderer.setPickId(anchor);
    assert.equal(renderer.setVisible(true), true);
    const primitive = renderer.getPrimitive();
    assert.equal(primitive.id, anchor);
    assert.equal(primitive.show, true);
    assert.equal(primitive.radii.x, 1_737_400);
    assert.equal(primitive.material.type, "OrbitLunarSolarSurface");
    assert.equal(primitive.material.uniforms.image, MOON_TEXTURE_URL);
    assert.equal(primitive.material.uniforms.repeat.x, 1);
    assert.equal(primitive.material.uniforms.repeat.y, 1);
    assert.equal(primitive.material.uniforms.nightSideEmission, 0.015);
    assert.match(primitive.material.fabric.source, /material\.diffuse = albedo/);
    assert.match(primitive.material.fabric.source, /material\.emission = albedo \* nightSideEmission/);
    assert.equal(primitive.material.minificationFilter, "linear-mipmap-linear");
    assert.equal(primitive.material.magnificationFilter, "linear");
    assert.equal(primitive.material.translucent, false);
    assert.equal(primitive.onlySunLighting, true);
    // Cesium.Moon uses an external-body opaque path without a depth test.
    assert.equal(primitive.depthTestEnabled, false);
    assert.equal(viewer.camera.frustum.far, 500_000_000);

    // The image material object remains stable between frames; the renderer
    // only updates the body transform and never replaces its texture source.
    primitive.material.uniforms.image = "stale-fallback-image";
    viewer.scene.preRender.raise({ id: "later", offset: 9 });
    assert.equal(primitive.material.uniforms.image, "stale-fallback-image");
    assert.equal(primitive.modelMatrix.rotation.orientationFor, "later");
    assert.deepEqual(primitive.modelMatrix.translation, new Cartesian3(10, 11, 12));

    assert.equal(renderer.setVisible(false), true);
    assert.equal(primitive.show, false);
    renderer.destroy();
    assert.equal(viewer.scene.primitives.values.length, 0);
    assert.equal(primitive.destroyed, true);
});

test("Moon texture is reduced to a portable WebGL canvas before upload", () => {
    const originalDocument = globalThis.document;
    const originalImage = globalThis.Image;
    const canvases = [];
    const drawCalls = [];
    let pendingImage = null;
    globalThis.document = {
        createElement(tagName) {
            assert.equal(tagName, "canvas");
            const context = {
                fillStyle: null,
                fillRect() {},
                drawImage(...argumentsList) {
                    drawCalls.push(argumentsList);
                }
            };
            const canvas = {
                width: 0,
                height: 0,
                getContext: (kind) => {
                    assert.equal(kind, "2d");
                    return context;
                }
            };
            canvases.push(canvas);
            return canvas;
        }
    };
    globalThis.Image = class FakeImage {
        constructor() {
            this.naturalWidth = 4096;
            this.naturalHeight = 2048;
            pendingImage = this;
        }

        set src(value) {
            this.source = value;
        }
    };

    try {
        const Cesium = createCesiumStub();
        const viewer = createViewer();
        const renderer = createCelestialSurfaceRenderer({
            kind: "moon",
            viewer,
            Cesium,
            radiusMeters: 1_737_400,
            getPosition: (_time, result) => Object.assign(result, { x: 10, y: 20, z: 30 })
        });

        assert.equal(renderer.setVisible(true), true);
        const primitive = renderer.getPrimitive();
        // Retaining this object is essential: browsers may otherwise collect
        // a detached Image before its asynchronous onload callback fires.
        assert.equal(primitive.material._orbitMoonSourceImage, pendingImage);
        assert.equal(primitive.material.uniforms.image.width, 1);

        pendingImage.onload();
        const textureCanvas = primitive.material.uniforms.image;
        assert.equal(canvases.length, 2);
        assert.equal(textureCanvas.width, 2048);
        assert.equal(textureCanvas.height, 1024);
        assert.equal(primitive.material._orbitMoonSourceImage, null);
        assert.equal(drawCalls.length, 1);
        assert.equal(drawCalls[0][3], 2048);
        assert.equal(drawCalls[0][4], 1024);
        // One request makes the body visible and the other flushes the
        // decoded canvas after its texture source changes.
        assert.equal(viewer.scene.renderRequests, 2);
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
        if (originalImage === undefined) delete globalThis.Image;
        else globalThis.Image = originalImage;
    }
});

test("Sun surface is a physical emissive primitive rather than the occluded environment Sun", () => {
    const Cesium = createCesiumStub();
    const viewer = createViewer();
    const renderer = createCelestialSurfaceRenderer({
        kind: "sun",
        viewer,
        Cesium,
        radiusMeters: 695_700_000,
        getPosition: (_time, result) => Object.assign(result, { x: 1_000, y: 0, z: 0 })
    });

    assert.equal(renderer.setVisible(true), true);
    const primitive = renderer.getPrimitive();
    assert.equal(primitive.radii.x, 695_700_000);
    assert.equal(primitive.onlySunLighting, false);
    assert.equal(primitive.depthTestEnabled, false);
    assert.equal(primitive.material.translucent, false);
    assert.equal(primitive.material.fabric.type, "OrbitSolarEmission");
    assert.equal(primitive.material.fabric.uniforms.granulationScale, 34);
    assert.equal(primitive.material.fabric.uniforms.flareIntensity, 0.82);
    assert.match(primitive.material.fabric.source, /solarCells/);
    assert.match(primitive.material.fabric.source, /solarFbm/);
    assert.match(primitive.material.fabric.source, /limbGlow/);
    assert.match(primitive.material.fabric.source, /czm_frameNumber/);
    // Cesium fabric declares uniforms from `uniforms`; declaring them again
    // in the source would make the physical Sun shader fail to compile.
    assert.doesNotMatch(primitive.material.fabric.source, /uniform\s+vec4\s+color/);
    // In Cesium Fabric, `czm_material.specular` is a float intensity. A vec3
    // assignment compiles into a WebGL dimension mismatch and stops rendering.
    assert.match(primitive.material.fabric.source, /material\.specular\s*=\s*0\.0\s*;/);
    assert.doesNotMatch(primitive.material.fabric.source, /material\.specular\s*=\s*vec3/);
    assert.deepEqual(primitive.modelMatrix.translation, new Cartesian3(1_000, 0, 0));
    assert.equal(viewer.camera.frustum.far > 695_700_000, true);

    renderer.setVisible(false);
    assert.equal(viewer.camera.frustum.far, 500_000_000);
});

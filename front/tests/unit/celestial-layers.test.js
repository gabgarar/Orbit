import assert from "node:assert/strict";
import test from "node:test";

import {
    CELESTIAL_LAYER_IDS,
    EARTH_LAYER_ID,
    EARTH_RADIUS_METERS,
    MOON_TEXTURE_URL,
    computeCelestialBodyFixedPosition,
    createCelestialBodyLayerManager,
    getCelestialLayerId,
    isEarthLayerId,
    isCelestialBodyLayerId
} from "../../js/rendering/celestialLayers.js";
import { applyStarsConfig } from "../../js/rendering/stars.js";

class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

class CallbackProperty {
    constructor(callback) {
        this.callback = callback;
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

    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
}

class IauOrientationAxes {
    evaluate(_time, result) {
        result.orientation = "moon";
        return result;
    }
}

function Material(options) {
    Object.assign(this, options);
    this.type = options?.fabric?.type;
    this.uniforms = { ...(options?.fabric?.uniforms || {}) };
}

Material.fromType = (type, uniforms) => ({ type, uniforms });

Matrix3.transpose = (matrix, result) => Object.assign(result, matrix, { transposed: true });
Matrix3.multiply = (fixed, axes, result) => Object.assign(result, axes, { fixedOffset: fixed.offset });
Matrix3.multiplyByVector = (matrix, vector, result) => {
    result.x = vector.x + matrix.offset;
    result.y = vector.y + matrix.offset;
    result.z = vector.z + matrix.offset;
    return result;
};
Matrix4.fromRotationTranslation = (rotation, translation, result) => Object.assign(result, { rotation, translation });
Matrix4.fromTranslation = (translation, result) => Object.assign(result, { translation });

function createCesiumStub() {
    return {
        Cartesian3,
        Cartesian2: class Cartesian2 {
            constructor(x, y) { this.x = x; this.y = y; }
        },
        CallbackProperty,
        Matrix4,
        EllipsoidPrimitive,
        IauOrientationAxes,
        Iau2000Orientation: { ComputeMoon: () => ({}) },
        Material,
        Color: {
            fromCssColorString: (value) => ({ value, withAlpha: (alpha) => ({ value, alpha }) })
        },
        Matrix3,
        Transforms: {
            computeIcrfToFixedMatrix: (time) => ({ offset: time.offset })
        },
        Simon1994PlanetaryPositions: {
            computeSunPositionInEarthInertialFrame: (_time, result) => Object.assign(result, { x: 10, y: 20, z: 30 }),
            computeMoonPositionInEarthInertialFrame: (_time, result) => Object.assign(result, { x: 1, y: 2, z: 3 })
        },
        JulianDate: {
            toDate: (time) => new Date(time.ms)
        }
    };
}

function createViewer(time = { offset: 1, ms: Date.UTC(2026, 6, 22) }) {
    const entities = [];
    const primitives = [];
    const preRenderListeners = new Set();
    return {
        clock: { currentTime: time },
        scene: {
            globe: { show: true },
            sun: { show: true, glowFactor: 2.2 },
            moon: { show: true, onlySunLighting: false },
            sunBloom: true,
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
                addEventListener: (listener) => preRenderListeners.add(listener),
                removeEventListener: (listener) => preRenderListeners.delete(listener)
            }
        },
        entities: {
            add: (entity) => { entities.push(entity); return entity; },
            remove: (entity) => {
                const index = entities.indexOf(entity);
                if (index >= 0) entities.splice(index, 1);
                return index >= 0;
            },
            values: entities
        }
    };
}

test("celestial layers use an opaque physical surface plus a non-rendering selection anchor", () => {
    const Cesium = createCesiumStub();
    const viewer = createViewer();
    const manager = createCelestialBodyLayerManager({ viewer, Cesium });

    // No layer means no native body, even if an old scene initially exposed it.
    assert.equal(viewer.scene.sun.show, false);
    assert.equal(viewer.scene.moon.show, false);
    assert.equal(viewer.scene.primitives.values.length, 0);
    assert.deepEqual(manager.getIds(), [EARTH_LAYER_ID]);
    assert.equal(viewer.scene.globe.show, true);

    assert.equal(manager.add("sun"), CELESTIAL_LAYER_IDS.sun);
    assert.equal(manager.add("sun"), CELESTIAL_LAYER_IDS.sun);
    assert.deepEqual(manager.getIds(), [EARTH_LAYER_ID, CELESTIAL_LAYER_IDS.sun]);
    assert.equal(viewer.entities.values.length, 2);
    assert.equal(viewer.scene.sun.show, false);
    assert.equal(viewer.scene.moon.show, false);

    const anchor = manager.getEntity("sun");
    assert.equal(anchor.ellipsoid, undefined);
    assert.deepEqual(anchor.position.callback({ offset: 4, ms: Date.UTC(2026, 6, 23) }, new Cartesian3()), new Cartesian3(14, 24, 34));
    const sun = manager.getSurfacePrimitive("sun");
    assert.equal(sun.radii.x, 695_700_000);
    assert.equal(sun.id, anchor);
    assert.equal(sun.material.fabric.type, "OrbitSolarEmission");

    // A custom primitive is not enough to suppress Cesium's native fallback:
    // if a frame transform is temporarily unavailable, the native body must
    // remain enabled instead of leaving the layer visually empty.
    Cesium.Transforms.computeIcrfToFixedMatrix = () => undefined;
    assert.equal(manager.setVisibility("sun", true), true);
    assert.equal(sun.show, false);
    assert.equal(viewer.scene.sun.show, true);

    manager.setVisibility("sun", false);
    assert.equal(anchor.show, false);
    assert.equal(viewer.scene.sun.show, false);
    assert.equal(sun.show, false);
});

test("Moon/Sun positions are calculated from the exact Cesium clock and body layers clear stale focus", () => {
    const Cesium = createCesiumStub();
    const viewer = createViewer({ offset: 7, ms: Date.UTC(2026, 6, 24) });
    const manager = createCelestialBodyLayerManager({ viewer, Cesium });

    const moonPosition = computeCelestialBodyFixedPosition({ Cesium, kind: "moon", time: viewer.clock.currentTime });
    assert.deepEqual(moonPosition, new Cartesian3(8, 9, 10));

    const moonId = manager.add("moon");
    const moon = manager.getEntity(moonId);
    const moonSurface = manager.getSurfacePrimitive(moonId);
    assert.equal(viewer.scene.moon.show, false);
    assert.equal(moonSurface.material.type, "EmissionMap");
    assert.equal(moonSurface.material.uniforms.image, MOON_TEXTURE_URL);
    // EmissionMap keeps the packaged lunar map visible independently of the
    // face currently illuminated by the Sun.
    assert.equal(moonSurface.onlySunLighting, false);
    assert.equal(moonSurface.id, moon);
    viewer.trackedEntity = moon;
    viewer.selectedEntity = moon;
    const telemetry = manager.getTelemetry(moonId);
    assert.equal(telemetry.source_format, "CELESTIAL");
    assert.equal(telemetry.position_frame, "ITRF / ECEF");
    assert.equal(telemetry.earth_center_distance_m > 0, true);
    assert.equal(telemetry.timestamp_ms, viewer.clock.currentTime.ms);

    assert.equal(manager.remove(moonId), true);
    assert.equal(viewer.scene.moon.show, false);
    assert.equal(viewer.trackedEntity, undefined);
    assert.equal(viewer.selectedEntity, undefined);
    // The permanent Earth anchor remains after project-owned bodies leave.
    assert.equal(viewer.entities.values.length, 1);
    assert.equal(viewer.scene.primitives.values.length, 0);
});

test("the Stars toggle leaves visible textured Moon/Sun layer surfaces intact", () => {
    const Cesium = createCesiumStub();
    Cesium.Color.BLACK = { css: "black" };
    const viewer = createViewer();
    const manager = createCelestialBodyLayerManager({ viewer, Cesium });
    const skyDome = {
        releases: 0,
        release() { this.releases += 1; },
        ensure() { throw new Error("The disabled star field must not be created."); }
    };

    manager.add("moon");
    manager.add("sun");
    const moon = manager.getSurfacePrimitive("moon");
    const sun = manager.getSurfacePrimitive("sun");
    assert.equal(moon.show, true);
    assert.equal(sun.show, true);
    assert.equal(moon.material.uniforms.image, MOON_TEXTURE_URL);
    assert.equal(sun.material.fabric.type, "OrbitSolarEmission");

    assert.equal(applyStarsConfig({
        viewer,
        Cesium,
        skyDome,
        systemConfig: { stars_enabled: false }
    }), false);

    assert.equal(skyDome.releases, 1);
    assert.equal(moon.show, true);
    assert.equal(sun.show, true);
    assert.equal(moon.material.uniforms.image, MOON_TEXTURE_URL);
    assert.equal(sun.material.fabric.type, "OrbitSolarEmission");
});

test("Earth is an immutable WGS84 scene layer with a real globe visibility toggle", () => {
    const Cesium = createCesiumStub();
    const viewer = createViewer();
    const manager = createCelestialBodyLayerManager({ viewer, Cesium });

    assert.equal(manager.has(EARTH_LAYER_ID), true);
    assert.equal(manager.getName(EARTH_LAYER_ID), "Earth");
    assert.equal(manager.getDefinition(EARTH_LAYER_ID).radiusMeters, EARTH_RADIUS_METERS);
    assert.equal(manager.getDefinition(EARTH_LAYER_ID).layerType, "EARTH");
    assert.equal(manager.getSurfacePrimitive(EARTH_LAYER_ID), null);

    const earth = manager.getEntity(EARTH_LAYER_ID);
    assert.equal(earth.properties.orbitLayerType, "EARTH");
    assert.deepEqual(earth.position.callback({ offset: 7 }, new Cartesian3(3, 4, 5)), new Cartesian3(0, 0, 0));
    assert.deepEqual(computeCelestialBodyFixedPosition({ Cesium, kind: "earth", result: new Cartesian3(1, 1, 1) }), new Cartesian3(0, 0, 0));

    const telemetry = manager.getTelemetry(EARTH_LAYER_ID);
    assert.equal(telemetry.celestial_body, "earth");
    assert.equal(telemetry.earth_center_distance_m, 0);
    assert.equal(telemetry.distance_from_earth_m, 0);

    assert.equal(manager.setVisibility(EARTH_LAYER_ID, false), true);
    assert.equal(viewer.scene.globe.show, false);
    assert.equal(manager.remove(EARTH_LAYER_ID), false);
    assert.equal(manager.clear(), false);
    assert.equal(manager.has(EARTH_LAYER_ID), true);
    assert.equal(manager.getVisibility(EARTH_LAYER_ID), true);
    assert.equal(viewer.scene.globe.show, true);
    assert.equal(manager.getSnapshot().some((entry) => entry.kind === "earth"), false);
});

test("Moon surface uses the packaged 4K lunar texture", () => {
    assert.equal(MOON_TEXTURE_URL, "/assets/basemap/Moon_color_16bit_srgb_4k.png");
});

test("celestial identifiers and project snapshots are normalised without duplicate bodies", () => {
    const Cesium = createCesiumStub();
    const viewer = createViewer();
    const manager = createCelestialBodyLayerManager({ viewer, Cesium });

    assert.equal(getCelestialLayerId("moon"), CELESTIAL_LAYER_IDS.moon);
    assert.equal(getCelestialLayerId("body:earth"), EARTH_LAYER_ID);
    assert.equal(getCelestialLayerId("body:sun"), CELESTIAL_LAYER_IDS.sun);
    assert.equal(isEarthLayerId("earth"), true);
    assert.equal(isCelestialBodyLayerId("body:moon"), true);
    assert.equal(isCelestialBodyLayerId("ISS"), false);

    assert.deepEqual(manager.restore([
        { id: "body:moon", visible: false },
        { kind: "moon", visible: true },
        { kind: "earth", visible: false },
        "sun",
        { kind: "invalid" }
    ]), [CELESTIAL_LAYER_IDS.moon, CELESTIAL_LAYER_IDS.sun]);
    assert.deepEqual(manager.getSnapshot(), [
        { kind: "moon", visible: false },
        { kind: "sun", visible: true }
    ]);
    assert.equal(viewer.scene.moon.show, false);
    assert.equal(viewer.scene.sun.show, false);
    assert.equal(viewer.scene.globe.show, true);
});

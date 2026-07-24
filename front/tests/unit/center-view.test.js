import assert from "node:assert/strict";
import test from "node:test";

import {
    centerViewOnEarth,
    centerViewOnEntity,
    getCelestialMaximumZoomDistance,
    getSafeCelestialFocusRange
} from "../../js/runtime/centerView.js";

test("celestial focus ranges remain outside the Moon and Sun with room for tracking", () => {
    const moonRadius = 1_737_400;
    const sunRadius = 695_700_000;
    const moonRange = getSafeCelestialFocusRange(moonRadius);
    const sunRange = getSafeCelestialFocusRange(sunRadius);

    assert.ok(moonRange > moonRadius);
    assert.ok(sunRange > sunRadius);
    assert.equal(moonRange, moonRadius * 3.25);
    assert.equal(sunRange, sunRadius * 3.25);
    assert.equal(getSafeCelestialFocusRange(0), null);
});

test("a detailed celestial surface can request a wider focus frame", () => {
    const moonRadius = 1_737_400;

    assert.equal(getSafeCelestialFocusRange(moonRadius, 4.25), moonRadius * 4.25);
    assert.equal(getSafeCelestialFocusRange(moonRadius, 1), moonRadius * 3.25);
});

test("celestial camera limits cover the Earth-to-body flight as well as local range", () => {
    const sunRange = getSafeCelestialFocusRange(695_700_000);
    const oneAu = 149_597_870_700;
    const maximum = getCelestialMaximumZoomDistance({
        focusRangeMeters: sunRange,
        earthCenterDistanceMeters: oneAu
    });

    assert.ok(maximum > oneAu);
    assert.equal(getCelestialMaximumZoomDistance({ focusRangeMeters: null }), 900_000_000);
});

test("centers and tracks any Cesium entity through the generic camera action", () => {
    const entity = { id: "body:moon" };
    const calls = [];
    const viewer = {
        flyTo(target, options) {
            calls.push({ target, options });
            return Promise.resolve(true);
        }
    };

    assert.equal(centerViewOnEntity({ viewer, entity }), true);
    assert.equal(viewer.selectedEntity, entity);
    assert.equal(viewer.trackedEntity, entity);
    assert.deepEqual(calls, [{ target: entity, options: { duration: 0.8 } }]);
});

test("can focus a physical body without installing Cesium's tracked-entity camera", () => {
    const entity = { id: "body:moon" };
    const sphere = { center: { x: 1, y: 2, z: 3 }, radius: 1_737_400 };
    const calls = [];
    const viewer = {
        trackedEntity: { id: "SAT-1" },
        camera: {
            flyToBoundingSphere(target, options) {
                calls.push({ target, options });
            }
        }
    };

    assert.equal(centerViewOnEntity({
        viewer,
        entity,
        focusBoundingSphere: sphere,
        trackEntity: false
    }), true);
    assert.equal(viewer.selectedEntity, entity);
    assert.equal(viewer.trackedEntity, undefined);
    assert.deepEqual(calls, [{ target: sphere, options: { duration: 0.8 } }]);
});

test("Earth keeps its layer selection but restores Cesium Home instead of tracking its origin", () => {
    const earth = { id: "body:earth" };
    const previousTracked = { id: "SAT-1" };
    const calls = [];
    const viewer = {
        selectedEntity: { id: "before" },
        trackedEntity: previousTracked,
        camera: {
            flyHome(duration) {
                calls.push(duration);
                return Promise.resolve(true);
            }
        }
    };

    assert.equal(centerViewOnEarth({ viewer, entity: earth }), true);
    assert.equal(viewer.selectedEntity, earth);
    assert.equal(viewer.trackedEntity, undefined);
    assert.deepEqual(calls, [0.8]);
});

test("Earth Home failures restore the previous selection and tracking state", () => {
    const previousSelected = { id: "before" };
    const previousTracked = { id: "SAT-1" };
    const warnings = [];
    const viewer = {
        selectedEntity: previousSelected,
        trackedEntity: previousTracked,
        camera: {
            flyHome() {
                throw new Error("camera unavailable");
            }
        }
    };

    assert.equal(centerViewOnEarth({
        viewer,
        entity: { id: "body:earth" },
        logger: { warn: (...args) => warnings.push(args) }
    }), false);
    assert.equal(viewer.selectedEntity, previousSelected);
    assert.equal(viewer.trackedEntity, previousTracked);
    assert.equal(warnings.length, 1);
});

test("is safe when no focusable entity or viewer is available", () => {
    assert.equal(centerViewOnEntity({ viewer: null, entity: { id: "x" } }), false);
    assert.equal(centerViewOnEntity({ viewer: {}, entity: null }), false);
});

test("preserves a caller-provided camera offset for point-like layers", () => {
    const entity = { id: "GST-1" };
    const offset = { range: 180000 };
    let options = null;
    const viewer = { flyTo(_entity, nextOptions) { options = nextOptions; } };

    centerViewOnEntity({ viewer, entity, flyToOptions: { offset } });
    assert.deepEqual(options, { duration: 0.8, offset });
});

test("uses an explicit sphere when an invisible positioning entity has no visual bounds", () => {
    const entity = { id: "body:moon" };
    const sphere = { center: { x: 1, y: 2, z: 3 }, radius: 1_737_400 };
    const calls = [];
    const viewer = {
        flyTo() {
            throw new Error("Viewer#flyTo must not be used for the invisible anchor");
        },
        camera: {
            flyToBoundingSphere(target, options) {
                calls.push({ target, options });
            }
        }
    };

    assert.equal(centerViewOnEntity({
        viewer,
        entity,
        focusBoundingSphere: sphere,
        flyToOptions: { offset: { range: 5_600_000 } }
    }), true);
    assert.equal(viewer.selectedEntity, entity);
    assert.equal(viewer.trackedEntity, entity);
    assert.deepEqual(calls, [{
        target: sphere,
        options: { duration: 0.8, offset: { range: 5_600_000 } }
    }]);
});

test("contains camera failures instead of breaking the context-menu flow", () => {
    const warnings = [];
    const viewer = {
        flyTo() {
            throw new Error("camera unavailable");
        }
    };

    assert.equal(centerViewOnEntity({ viewer, entity: { id: "SAT-1" }, logger: { warn: (...args) => warnings.push(args) } }), false);
    assert.equal(warnings.length, 1);
    assert.equal(viewer.selectedEntity, undefined);
    assert.equal(viewer.trackedEntity, undefined);
});

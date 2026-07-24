import assert from "node:assert/strict";
import test from "node:test";

import { createBodyCentricCameraController } from "../../js/runtime/bodyCentricCamera.js";

function createCesiumStub() {
    class Cartesian3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        static clone(value, result = new Cartesian3()) {
            result.x = value.x;
            result.y = value.y;
            result.z = value.z;
            return result;
        }

        static equalsEpsilon(left, right, _relativeEpsilon, absoluteEpsilon = 0) {
            return Math.abs(left.x - right.x) <= absoluteEpsilon
                && Math.abs(left.y - right.y) <= absoluteEpsilon
                && Math.abs(left.z - right.z) <= absoluteEpsilon;
        }
    }

    class Matrix4 {}
    Matrix4.IDENTITY = { kind: "identity" };
    Matrix4.fromTranslation = (position, result = new Matrix4()) => {
        result.kind = "translation";
        result.x = position.x;
        result.y = position.y;
        result.z = position.z;
        return result;
    };

    return { Cartesian3, Matrix4 };
}

function createViewer(Cesium) {
    let preRender = null;
    const calls = [];
    const viewer = {
        clock: { currentTime: "now" },
        scene: {
            preRender: {
                addEventListener(listener) {
                    preRender = listener;
                },
                removeEventListener(listener) {
                    if (preRender === listener) preRender = null;
                }
            }
        },
        camera: {
            position: new Cesium.Cartesian3(2_400_000, -1_900_000, -6_500_000),
            lookAtTransform(...args) {
                calls.push(args);
            }
        }
    };
    return { viewer, calls, render: (time = "now") => preRender?.(viewer.scene, time) };
}

test("installs a translation-only Moon frame after its current camera flight", () => {
    const Cesium = createCesiumStub();
    const { viewer, calls } = createViewer(Cesium);
    let moonPosition = new Cesium.Cartesian3(384_400_000, 0, 0);
    const controller = createBodyCentricCameraController({
        viewer,
        Cesium,
        getBodyPosition: (id) => id === "body:moon" ? moonPosition : null
    });

    const ticket = controller.beginFocus("body:moon");

    assert.equal(controller.getFocusedBodyId(), "body:moon");
    assert.equal(controller.activateAfterFlight(ticket), true);
    assert.equal(controller.getFocusedBodyId(), "body:moon");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1);
    assert.deepEqual(
        { kind: calls[0][0].kind, x: calls[0][0].x, y: calls[0][0].y, z: calls[0][0].z },
        { kind: "translation", x: 384_400_000, y: 0, z: 0 }
    );

    // Keep the variable live to document that a callback property may return
    // a fresh Cartesian object on every frame.
    moonPosition = new Cesium.Cartesian3(384_400_000, 0, 0);
});

test("follows the Moon by reusing the local camera offset rather than Earth origin", () => {
    const Cesium = createCesiumStub();
    const { viewer, calls, render } = createViewer(Cesium);
    let moonPosition = new Cesium.Cartesian3(384_400_000, 0, 0);
    const controller = createBodyCentricCameraController({
        viewer,
        Cesium,
        getBodyPosition: () => moonPosition
    });

    const ticket = controller.beginFocus("body:moon");
    controller.activateAfterFlight(ticket);
    const originalOffset = { ...viewer.camera.position };

    moonPosition = new Cesium.Cartesian3(384_400_000, 12_000, 0);
    render("later");

    assert.equal(calls.length, 2);
    assert.deepEqual({
        kind: calls[1][0].kind,
        x: calls[1][0].x,
        y: calls[1][0].y,
        z: calls[1][0].z
    }, {
        kind: "translation",
        x: 384_400_000,
        y: 12_000,
        z: 0
    });
    assert.deepEqual(
        { x: calls[1][1].x, y: calls[1][1].y, z: calls[1][1].z },
        originalOffset
    );
    assert.notEqual(calls[1][1], viewer.camera.position);
});

test("ignores stale flights and restores the ordinary Earth frame on deactivation", () => {
    const Cesium = createCesiumStub();
    const { viewer, calls } = createViewer(Cesium);
    const controller = createBodyCentricCameraController({
        viewer,
        Cesium,
        getBodyPosition: () => new Cesium.Cartesian3(384_400_000, 0, 0)
    });

    const staleTicket = controller.beginFocus("body:moon");
    const currentTicket = controller.beginFocus("body:moon");

    assert.equal(controller.activateAfterFlight(staleTicket), false);
    assert.equal(controller.activateAfterFlight(currentTicket), true);
    controller.deactivate();

    assert.equal(controller.getFocusedBodyId(), null);
    assert.equal(calls.at(-1)[0], Cesium.Matrix4.IDENTITY);
});

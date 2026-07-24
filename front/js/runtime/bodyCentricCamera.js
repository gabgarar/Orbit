/**
 * Keeps Cesium's ordinary centred camera controls around a moving physical
 * body without using Viewer#trackedEntity / EntityView.
 *
 * EntityView is useful for satellites, but it also installs the entity's
 * dynamic reference frame.  For a Moon-like body that makes the camera feel
 * unlike the globe controller.  A translation-only frame gives the controller
 * a local origin at the body's centre while retaining the Earth's familiar
 * world-up axis and interaction model.
 */

const POSITION_EPSILON_METERS = 0.01;

function cloneCartesian(Cesium, value, result) {
    if (!value) {
        return null;
    }
    if (typeof Cesium?.Cartesian3?.clone === "function") {
        return Cesium.Cartesian3.clone(value, result || undefined);
    }
    if (typeof value.x !== "number" || typeof value.y !== "number" || typeof value.z !== "number") {
        return null;
    }
    const target = result || {};
    target.x = value.x;
    target.y = value.y;
    target.z = value.z;
    return target;
}

function positionsEqual(Cesium, left, right) {
    if (!left || !right) {
        return false;
    }
    if (typeof Cesium?.Cartesian3?.equalsEpsilon === "function") {
        return Cesium.Cartesian3.equalsEpsilon(left, right, 0, POSITION_EPSILON_METERS);
    }
    return Math.abs(left.x - right.x) <= POSITION_EPSILON_METERS
        && Math.abs(left.y - right.y) <= POSITION_EPSILON_METERS
        && Math.abs(left.z - right.z) <= POSITION_EPSILON_METERS;
}

/**
 * Creates a controller that follows an external body's translation while
 * keeping the camera's local orbit around that body.  The body rotation is
 * intentionally not included in the reference frame: the lunar renderer
 * still uses its IAU orientation, while drag behaviour stays consistent with
 * the Earth globe.
 */
export function createBodyCentricCameraController({
    viewer,
    Cesium,
    getBodyPosition
} = {}) {
    const camera = viewer?.camera;
    const preRender = viewer?.scene?.preRender;
    const canUseCamera = Boolean(
        camera
        && typeof camera.lookAtTransform === "function"
        && typeof Cesium?.Matrix4?.fromTranslation === "function"
    );
    const translationFrameResult = typeof Cesium?.Matrix4 === "function"
        ? new Cesium.Matrix4()
        : undefined;
    const positionResult = typeof Cesium?.Cartesian3 === "function"
        ? new Cesium.Cartesian3()
        : undefined;
    const cameraOffsetResult = typeof Cesium?.Cartesian3 === "function"
        ? new Cesium.Cartesian3()
        : undefined;
    let activeBodyId = null;
    let pendingFocus = null;
    let focusSequence = 0;
    let lastBodyPosition = null;
    let hasLocalFrame = false;

    const getPosition = (bodyId, time) => {
        if (typeof getBodyPosition !== "function") {
            return null;
        }
        return getBodyPosition(bodyId, time, positionResult) || null;
    };

    const createTranslationFrame = (position) => Cesium.Matrix4.fromTranslation(
        position,
        translationFrameResult
    );

    const releaseLocalFrame = () => {
        if (!hasLocalFrame) {
            return;
        }
        const identity = Cesium?.Matrix4?.IDENTITY;
        if (identity) {
            camera.lookAtTransform(identity);
        }
        hasLocalFrame = false;
        lastBodyPosition = null;
    };

    const update = (time = viewer?.clock?.currentTime) => {
        if (!canUseCamera || !activeBodyId) {
            return false;
        }
        const bodyPosition = getPosition(activeBodyId, time);
        if (!bodyPosition) {
            return false;
        }
        if (hasLocalFrame && positionsEqual(Cesium, bodyPosition, lastBodyPosition)) {
            return true;
        }

        const frame = createTranslationFrame(bodyPosition);
        if (!hasLocalFrame) {
            // No offset deliberately preserves the just-completed world-space
            // flight. It only changes the camera's reference origin.
            camera.lookAtTransform(frame);
            hasLocalFrame = true;
        } else {
            // `camera.position` is already expressed in the current local
            // body frame. Reusing that Cartesian offset moves the camera by
            // the body's ephemeris delta instead of leaving it behind at
            // Earth, and keeps left-drag orbiting the Moon.
            const localOffset = cloneCartesian(Cesium, camera.position, cameraOffsetResult);
            if (localOffset) {
                camera.lookAtTransform(frame, localOffset);
            } else {
                camera.lookAtTransform(frame);
            }
        }
        lastBodyPosition = cloneCartesian(Cesium, bodyPosition, lastBodyPosition);
        return true;
    };

    const onPreRender = (_scene, time) => {
        update(time || viewer?.clock?.currentTime);
    };
    preRender?.addEventListener?.(onPreRender);

    return {
        /** Starts a body focus and returns a ticket tied to that flight. */
        beginFocus(bodyId) {
            if (!canUseCamera || !bodyId) {
                return null;
            }
            releaseLocalFrame();
            activeBodyId = null;
            const ticket = ++focusSequence;
            pendingFocus = { bodyId, ticket };
            return ticket;
        },

        /** Installs the local body frame only if its flight is still current. */
        activateAfterFlight(ticket) {
            if (!pendingFocus || pendingFocus.ticket !== ticket) {
                return false;
            }
            activeBodyId = pendingFocus.bodyId;
            pendingFocus = null;
            return update();
        },

        cancelFocus(ticket) {
            if (pendingFocus?.ticket !== ticket) {
                return false;
            }
            pendingFocus = null;
            return true;
        },

        update,

        deactivate() {
            pendingFocus = null;
            activeBodyId = null;
            releaseLocalFrame();
        },

        getFocusedBodyId() {
            return activeBodyId || pendingFocus?.bodyId || null;
        },

        destroy() {
            this.deactivate();
            preRender?.removeEventListener?.(onPreRender);
        }
    };
}

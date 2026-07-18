const ACTIONABLE_KEYS = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

function isEditableTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function normalizeKey(key) {
    return key ? String(key).toLowerCase() : "";
}

/**
 * Installs keyboard movement only while the supplied navigation mode is free.
 * The returned API is idempotent, so callers may safely enable/disable it from
 * view-mode transitions without duplicating browser or Cesium listeners.
 */
export function createFreeCameraKeyboardControls({ viewer, isFreeMode }) {
    const pressedKeys = new Set();
    let tickListener = null;
    let keyboardAttached = false;

    const onKeyDown = (event) => {
        if (!isFreeMode() || isEditableTarget(event.target)) return;
        const key = normalizeKey(event.key);
        if (!ACTIONABLE_KEYS.has(key)) return;
        pressedKeys.add(key);
        event.preventDefault();
    };
    const onKeyUp = (event) => pressedKeys.delete(normalizeKey(event.key));
    const move = () => {
        if (!isFreeMode()) return;
        const camera = viewer.camera;
        const height = Math.max(1, camera.positionCartographic?.height || 5000);
        const moveStep = Math.min(Math.max(height * 0.025, 40), 2500000);
        const lookStep = 0.012;
        if (pressedKeys.has("w")) camera.moveForward(moveStep);
        if (pressedKeys.has("s")) camera.moveBackward(moveStep);
        if (pressedKeys.has("a")) camera.moveLeft(moveStep);
        if (pressedKeys.has("d")) camera.moveRight(moveStep);
        if (pressedKeys.has("q")) camera.moveDown(moveStep);
        if (pressedKeys.has("e")) camera.moveUp(moveStep);
        if (pressedKeys.has("arrowup")) camera.lookUp(lookStep);
        if (pressedKeys.has("arrowdown")) camera.lookDown(lookStep);
        if (pressedKeys.has("arrowleft")) camera.lookLeft(lookStep);
        if (pressedKeys.has("arrowright")) camera.lookRight(lookStep);
    };

    const enable = () => {
        if (!keyboardAttached) {
            window.addEventListener("keydown", onKeyDown, { passive: false });
            window.addEventListener("keyup", onKeyUp);
            keyboardAttached = true;
        }
        if (!tickListener) {
            tickListener = move;
            viewer.clock.onTick.addEventListener(tickListener);
        }
    };
    const disable = () => {
        pressedKeys.clear();
        if (tickListener) {
            viewer.clock.onTick.removeEventListener(tickListener);
            tickListener = null;
        }
        if (keyboardAttached) {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            keyboardAttached = false;
        }
    };
    return { enable, disable };
}

export function setupCameraActions({ viewer, resetView, toggleNavigation }) {
    window.addEventListener("orbit:camera-action", (event) => {
        const action = event.detail?.type;
        if (action === "reset") resetView();
        if (action === "3d") viewer.scene.morphTo3D(0.5);
        if (action === "2d") viewer.scene.morphTo2D(0.5);
        if (action === "columbus") viewer.scene.morphToColumbusView(0.5);
        if (action === "navigation") toggleNavigation();
    });
}

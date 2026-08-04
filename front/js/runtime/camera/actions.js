export function setupCameraActions({ viewer, resetView, toggleNavigation, setNavigationMode, publishCameraState }) {
    const publishState = () => {
        if (typeof publishCameraState === "function") {
            publishCameraState();
        }
    };

    window.addEventListener("orbit:camera-action", (event) => {
        const action = event.detail?.type;
        if (action === "reset") resetView();
        if (action === "3d") viewer.scene.morphTo3D(0.5);
        if (action === "2d") viewer.scene.morphTo2D(0.5);
        if (action === "columbus") viewer.scene.morphToColumbusView(0.5);
        if (action === "navigation") toggleNavigation();
        if (action === "navigation-free") setNavigationMode?.("free");
        if (action === "navigation-centered") setNavigationMode?.("centered");
    });

    // React can mount before Cesium has finished initialising. It asks for a
    // snapshot whenever the menu opens, and completed morphs keep the selected
    // projection in sync with Cesium's own scene-mode picker as well.
    window.addEventListener("orbit:camera-state-request", publishState);
    viewer.scene.morphComplete.addEventListener(publishState);
    publishState();
}

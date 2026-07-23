export function applyStarsConfig({ viewer, Cesium, skyDome, systemConfig, logger }) {
    const scene = viewer?.scene;
    if (!scene) return false;

    const enabled = systemConfig?.stars_enabled !== false;
    // Tycho is only the background.  It must not own Cesium's environment
    // Sun/Moon flags: the celestial-layer manager owns those as a native
    // fallback while its independent physical surfaces initialise/upload.
    scene.skyBox = undefined;
    if (enabled) {
        skyDome?.ensure?.();
    } else {
        skyDome?.release?.();
        if (Cesium?.Color?.BLACK) {
            scene.backgroundColor = Cesium.Color.BLACK;
        }
    }

    // A star-dome change removes/adds an opaque primitive.  Requesting a
    // frame makes already-visible Moon/Sun surface materials redraw even in
    // a viewer configured for explicit rendering.
    scene.requestRender?.();
    logger?.info?.(`Stars: ${enabled ? "on" : "off"} | skydome: TychoSkyMapHighRes`);
    return enabled;
}

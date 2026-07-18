export function applyStarsConfig({ viewer, Cesium, skyDome, systemConfig, logger }) {
    const enabled = systemConfig.stars_enabled !== false;
    viewer.scene.skyBox = undefined;
    if (enabled) skyDome.ensure(); else skyDome.release();
    viewer.scene.sun.show = enabled;
    viewer.scene.moon.show = false;
    if (!enabled) viewer.scene.backgroundColor = Cesium.Color.BLACK;
    logger.info(`Stars: ${enabled ? "on" : "off"} | skydome: TychoSkyMapHighRes`);
}

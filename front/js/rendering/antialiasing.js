export function applyAntialiasMode({ viewer, systemConfig, logger }) {
    const mode = systemConfig.antialias_mode ?? (systemConfig.antialias_enabled !== false ? "fxaa" : "off");
    const fxaaEnabled = mode === "fxaa";
    viewer.scene.fxaa = fxaaEnabled;
    if (viewer.scene.postProcessStages?.fxaa) viewer.scene.postProcessStages.fxaa.enabled = fxaaEnabled;
    if (typeof viewer.scene.msaaSamples === "number") viewer.scene.msaaSamples = mode === "msaa" ? 4 : 1;
    logger.info(`Antialias mode: ${mode}`);
}

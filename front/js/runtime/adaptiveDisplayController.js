/** Applies adaptive rendering and interface scale while avoiding redundant resizes. */
export function createAdaptiveDisplayController({ viewer, windowRef, documentRef, getResolutionScale, getUiScale, logger }) {
    let resolutionScale = null;
    let uiScale = null;
    let resizeFrame = null;
    const applyResolution = (systemConfig, { silent = false } = {}) => {
        let nextScale = getResolutionScale(windowRef);
        const antialiasMode = systemConfig.antialias_mode ?? (systemConfig.antialias_enabled !== false ? "fxaa" : "off");
        if (antialiasMode !== "off") nextScale = Math.max(0.9, nextScale);
        if (Number.isFinite(resolutionScale) && Math.abs(resolutionScale - nextScale) <= 0.005) return;
        viewer.useBrowserRecommendedResolution = false;
        viewer.resolutionScale = nextScale;
        viewer.resize();
        resolutionScale = nextScale;
        if (!silent) logger.info(`Resolution scale: ${nextScale.toFixed(3)} (auto)`);
    };
    const applyUi = (_systemConfig, { silent = false } = {}) => {
        const nextScale = getUiScale(windowRef);
        if (Number.isFinite(uiScale) && Math.abs(uiScale - nextScale) <= 0.005) return;
        documentRef.documentElement.style.setProperty("--orbit-ui-scale", nextScale.toFixed(3));
        uiScale = nextScale;
        if (!silent) logger.info(`UI scale: ${nextScale.toFixed(3)} (auto)`);
    };
    const scheduleResize = (getConfig) => {
        if (resizeFrame !== null) windowRef.cancelAnimationFrame(resizeFrame);
        resizeFrame = windowRef.requestAnimationFrame(() => {
            const config = getConfig();
            if (config) { applyResolution(config, { silent: true }); applyUi(config, { silent: true }); }
            resizeFrame = null;
        });
    };
    return { applyResolution, applyUi, scheduleResize };
}

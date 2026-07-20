/** Applies adaptive rendering and interface scale while avoiding redundant resizes. */
const MIN_ANTIALIASED_RESOLUTION_SCALE = 1;
export function createAdaptiveDisplayController({ viewer, windowRef, documentRef, getResolutionScale, getUiScale, logger }) {
    let resolutionScale = null;
    let uiScale = null;
    let resizeFrame = null;
    const applyResolution = (systemConfig, { silent = false } = {}) => {
        let nextScale = getResolutionScale(windowRef);
        const antialiasMode = systemConfig.antialias_mode ?? (systemConfig.antialias_enabled !== false ? "fxaa" : "off");
        // Downsampling thin WebGL polylines makes their edges visibly jagged.
        // Keep the adaptive reduction only for the explicit no-AA mode; full
        // resolution is the quality baseline whenever an AA mode is selected.
        if (antialiasMode !== "off") nextScale = Math.max(MIN_ANTIALIASED_RESOLUTION_SCALE, nextScale);
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

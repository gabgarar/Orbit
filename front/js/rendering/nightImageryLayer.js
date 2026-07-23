/** Manages the optional night-lights layer without replacing Cesium's base map. */
export function createNightImageryLayer({ viewer, provider, alpha = 0.72, brightness = 1.45, onAttached }) {
    let layer = null;
    let isVisible = true;
    const configure = (nextVisible = true) => {
        const shouldShow = nextVisible === true;
        isVisible = shouldShow;
        if (!layer) return;
        layer.show = shouldShow;
        layer.dayAlpha = 0;
        layer.nightAlpha = shouldShow ? alpha : 0;
        layer.brightness = brightness;
    };
    const attach = () => {
        if (layer && viewer?.scene?.imageryLayers?.contains?.(layer)) return layer;
        layer = viewer.scene.imageryLayers.addImageryProvider(provider);
        configure(isVisible);
        onAttached?.();
        return layer;
    };
    return {
        attach,
        attachDeferred: () => window.setTimeout(attach, 0),
        configure,
        getLayer: () => layer,
        isAttached: () => Boolean(layer && viewer?.scene?.imageryLayers?.contains?.(layer))
    };
}

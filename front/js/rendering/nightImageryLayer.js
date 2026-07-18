/** Manages the optional night-lights layer without replacing Cesium's base map. */
export function createNightImageryLayer({ viewer, provider, alpha = 0.72, brightness = 1.45, onAttached }) {
    let layer = null;
    const configure = (visible = true) => {
        if (!layer) return;
        layer.show = visible;
        layer.dayAlpha = 0;
        layer.nightAlpha = visible ? alpha : 0;
        layer.brightness = brightness;
    };
    const attach = () => {
        if (layer) return layer;
        layer = viewer.scene.imageryLayers.addImageryProvider(provider);
        configure(true);
        onAttached?.();
        return layer;
    };
    return { attachDeferred: () => window.setTimeout(attach, 0), configure, isAttached: () => Boolean(layer) };
}

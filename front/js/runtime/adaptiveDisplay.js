/**
 * Responsive display policy.
 *
 * Keeping these calculations independent from Cesium and the application
 * bootstrap makes the viewport behavior easy to test and reuse.
 */

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function getAdaptiveResolutionScale(viewport = window) {
    const width = Math.max(1, viewport.innerWidth || 1920);
    const height = Math.max(1, viewport.innerHeight || 1080);
    const referencePixels = 1920 * 1080;
    const viewportRatio = (width * height) / referencePixels;

    if (viewportRatio <= 0.55) return 0.84;
    if (viewportRatio <= 0.7) return 0.9;
    if (viewportRatio <= 0.9) return 0.95;
    return 1;
}

export function getAdaptiveUiScale(viewport = window) {
    const width = Math.max(1, viewport.innerWidth || 1920);
    const height = Math.max(1, viewport.innerHeight || 1080);
    const viewportScale = Math.min(width / 1920, height / 1080);

    // Orbit uses a compact desktop density by default. It matches the more
    // comfortable layout produced by an 80% browser zoom while remaining
    // responsive to the actual viewport size.
    return clamp(viewportScale * 0.84, 0.68, 0.9);
}

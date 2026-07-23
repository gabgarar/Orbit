const DEFAULT_CENTER_VIEW_DURATION_SECONDS = 0.8;
const CELESTIAL_BODY_VIEW_RANGE_MULTIPLIER = 3.25;
const DEFAULT_MAXIMUM_ZOOM_DISTANCE_METERS = 900_000_000;

/**
 * Returns a camera range that remains comfortably outside a spherical body.
 * The range is measured from the body's centre, so it must be strictly
 * larger than its radius.  Keeping more than two radii of clearance also
 * gives `Viewer#trackedEntity` a stable view after the initial flight ends.
 */
export function getSafeCelestialFocusRange(
    radiusMeters,
    multiplier = CELESTIAL_BODY_VIEW_RANGE_MULTIPLIER
) {
    const radius = Number(radiusMeters);
    if (!Number.isFinite(radius) || radius <= 0) {
        return null;
    }
    // Keep the default framing for generic bodies, while allowing a body
    // with a detailed surface (notably the Moon) to request a wider,
    // inspection-friendly view. A camera range must remain outside the body.
    const requestedMultiplier = Number(multiplier);
    const safeMultiplier = Number.isFinite(requestedMultiplier) && requestedMultiplier > 1
        ? requestedMultiplier
        : CELESTIAL_BODY_VIEW_RANGE_MULTIPLIER;
    return radius * safeMultiplier;
}

/**
 * Cesium's controller limits camera distance in world space.  A tracked Sun
 * is roughly one AU from Earth, so its safe local view range alone is not
 * enough to lift that limit.  Preserve the normal app cap for nearby objects
 * and expand it only for a valid celestial focus target.
 */
export function getCelestialMaximumZoomDistance({
    focusRangeMeters,
    earthCenterDistanceMeters = 0,
    fallbackMeters = DEFAULT_MAXIMUM_ZOOM_DISTANCE_METERS
} = {}) {
    const fallback = Number.isFinite(Number(fallbackMeters)) && Number(fallbackMeters) > 0
        ? Number(fallbackMeters)
        : DEFAULT_MAXIMUM_ZOOM_DISTANCE_METERS;
    const focusRange = Number(focusRangeMeters);
    const earthCenterDistance = Number(earthCenterDistanceMeters);
    if (!Number.isFinite(focusRange) || focusRange <= 0) {
        return fallback;
    }
    return Math.max(fallback, Math.max(0, Number.isFinite(earthCenterDistance) ? earthCenterDistance : 0) + (focusRange * 1.25));
}

/**
 * Centers Cesium on an entity without assuming that the entity is a
 * satellite.  Celestial bodies, ground stations and future mission objects
 * can therefore use the exact same contextual action.
 *
 * Cesium derives the appropriate bounding volume for an ellipsoid body when
 * `Viewer#flyTo` is used, while dynamic satellite entities keep following
 * their position through `trackedEntity`.
 */
export function centerViewOnEntity({
    viewer,
    entity,
    duration = DEFAULT_CENTER_VIEW_DURATION_SECONDS,
    flyToOptions = {},
    focusBoundingSphere = null,
    logger = null
} = {}) {
    if (!viewer || !entity) {
        return false;
    }

    const previousSelectedEntity = viewer.selectedEntity;
    const previousTrackedEntity = viewer.trackedEntity;
    try {
        viewer.selectedEntity = entity;
        viewer.trackedEntity = entity;

        const options = { ...flyToOptions, duration };
        // A position-only entity is deliberately used for physically-rendered
        // bodies such as the Moon. It remains a stable selection/tracking
        // target, but has no Entity visualizer bounding volume for
        // `Viewer#flyTo`. In that case the caller supplies the body's real
        // sphere and the camera can still make an exact, safe flight.
        const canFocusBoundingSphere = Boolean(
            focusBoundingSphere
            && typeof viewer.camera?.flyToBoundingSphere === "function"
        );
        if (canFocusBoundingSphere) {
            const result = viewer.camera.flyToBoundingSphere(focusBoundingSphere, options);
            if (result && typeof result.catch === "function") {
                result.catch((error) => logger?.warn?.("No se pudo centrar la vista en el objeto.", error));
            }
        } else if (typeof viewer.flyTo === "function") {
            const result = viewer.flyTo(entity, options);
            // Camera flights can be superseded by a later user command.  That
            // is an expected interaction, not an unhandled application error.
            if (result && typeof result.catch === "function") {
                result.catch((error) => logger?.warn?.("No se pudo centrar la vista en el objeto.", error));
            }
        }
        return true;
    } catch (error) {
        // Do not leave the camera tracking a target that could not be focused
        // (for example, an entity whose position was removed mid-frame).
        try {
            viewer.selectedEntity = previousSelectedEntity;
            viewer.trackedEntity = previousTrackedEntity;
        } catch {
            // The original camera error is the useful diagnostic here.
        }
        logger?.warn?.("No se pudo iniciar el centrado de la vista.", error);
        return false;
    }
}

/**
 * Focuses the reference Earth without treating it like an external physical
 * body.  Moon/Sun need an explicit bounding sphere because their anchors are
 * position-only entities far from Earth; Earth itself is the scene's home
 * frame, so Cesium's native Home framing is the familiar and least surprising
 * result.  It deliberately does not track the zero-position Earth anchor,
 * which would otherwise replace Home with an artificial close-up.
 */
export function centerViewOnEarth({
    viewer,
    entity,
    duration = DEFAULT_CENTER_VIEW_DURATION_SECONDS,
    logger = null
} = {}) {
    if (!viewer || !entity) {
        return false;
    }

    const previousSelectedEntity = viewer.selectedEntity;
    const previousTrackedEntity = viewer.trackedEntity;
    try {
        viewer.selectedEntity = entity;
        viewer.trackedEntity = undefined;

        if (typeof viewer.camera?.flyHome === "function") {
            const result = viewer.camera.flyHome(duration);
            if (result && typeof result.catch === "function") {
                result.catch((error) => logger?.warn?.("No se pudo restaurar la vista Home de la Tierra.", error));
            }
            return true;
        }

        // `flyHome` is present in Cesium's Camera. Keep a small fallback for
        // embedded/minimal viewers so selecting Earth never traps the user in
        // a tracked-at-origin camera state.
        if (typeof viewer.homeButton?.viewModel?.command === "function") {
            viewer.homeButton.viewModel.command();
            return true;
        }

        throw new Error("Cesium Home camera action is unavailable");
    } catch (error) {
        try {
            viewer.selectedEntity = previousSelectedEntity;
            viewer.trackedEntity = previousTrackedEntity;
        } catch {
            // Keep the original focus failure as the useful diagnostic.
        }
        logger?.warn?.("No se pudo centrar la vista en la Tierra.", error);
        return false;
    }
}

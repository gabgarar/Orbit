/**
 * Render state for the Tycho shell.
 *
 * The shell is ordinary scene geometry rather than Cesium's built-in skybox,
 * so it must never stamp the depth buffer.  It does still test depth: that
 * lets an Earth, Moon or any other physical primitive win whether it is
 * submitted before or after the star shell.  Disabling the test as well would
 * make the shell paint over a body whenever Cesium happens to execute it
 * later in the opaque pass.
 */
export function getTychoSkyDomeRenderState() {
    return {
        depthTest: { enabled: true },
        depthMask: false
    };
}

/** Owns the Cesium primitive and render listener for the Tycho star texture. */
export function createTychoSkyDome({ viewer, Cesium, textureUrl, radius = 1_000_000_000 }) {
    let primitive = null;
    let updateListener = null;
    const updateTransform = () => {
        if (primitive && viewer.camera?.positionWC) {
            primitive.modelMatrix = Cesium.Matrix4.fromTranslation(viewer.camera.positionWC, primitive.modelMatrix);
        }
    };
    const ensure = () => {
        if (primitive) return primitive;
        const material = Cesium.Material.fromType("Image", { image: textureUrl, repeat: new Cesium.Cartesian2(1, 1), transparent: false });
        primitive = viewer.scene.primitives.add(new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.SphereGeometry({ radius, vertexFormat: Cesium.VertexFormat.POSITION_AND_ST }) }),
            appearance: new Cesium.MaterialAppearance({
                material,
                faceForward: true,
                closed: false,
                translucent: false,
                flat: true,
                renderState: getTychoSkyDomeRenderState()
            }),
            asynchronous: false
        }));
        updateTransform();
        updateListener = updateTransform;
        viewer.scene.preRender.addEventListener(updateListener);
        return primitive;
    };
    const release = () => {
        if (updateListener) {
            viewer.scene.preRender.removeEventListener(updateListener);
            updateListener = null;
        }
        if (!primitive) return;
        viewer.scene.primitives.remove(primitive);
        if (typeof primitive.destroy === "function" && !primitive.isDestroyed?.()) primitive.destroy();
        primitive = null;
    };
    return { ensure, release };
}

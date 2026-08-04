/** Creates the temporary Cesium scene displayed before a project is opened. */
export function createWelcomeScene({ viewer, Cesium, updateGlobeLighting }) {
    let entities = [];
    let cameraActive = false;
    let depthTestBefore = null;
    let frustumOffsetsBefore = null;

    const setup = () => {
        if (cameraActive) return;
        cameraActive = true;
        viewer.trackedEntity = undefined;
        viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(15, 28, 26_000_000), orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0 } });
        const frustum = viewer.camera.frustum;
        if (Number.isFinite(frustum?.xOffset) && Number.isFinite(frustum?.yOffset)) {
            frustumOffsetsBefore = { x: frustum.xOffset, y: frustum.yOffset };
            const halfHeight = Math.tan(frustum.fovy * 0.5) * frustum.near;
            frustum.xOffset = halfHeight * frustum.aspectRatio * 0.55;
            frustum.yOffset = halfHeight * 0.65;
        }
        depthTestBefore = viewer.scene.globe.depthTestAgainstTerrain;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        const radius = Cesium.Ellipsoid.WGS84.maximumRadius + 1_450_000;
        const horizontal = Cesium.Cartesian3.normalize(viewer.camera.rightWC, new Cesium.Cartesian3());
        const screenUp = Cesium.Cartesian3.normalize(viewer.camera.upWC, new Cesium.Cartesian3());
        const towardCamera = Cesium.Cartesian3.normalize(viewer.camera.positionWC, new Cesium.Cartesian3());
        const inclinedUp = Cesium.Cartesian3.normalize(Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(screenUp, 0.82, new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(towardCamera, 0.58, new Cesium.Cartesian3()), new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const pointCount = 180;
        const orbitPoints = Array.from({ length: pointCount + 1 }, (_, index) => {
            const angle = (index / pointCount) * Cesium.Math.TWO_PI;
            const horizontalPart = Cesium.Cartesian3.multiplyByScalar(horizontal, Math.cos(angle) * radius, new Cesium.Cartesian3());
            const verticalPart = Cesium.Cartesian3.multiplyByScalar(inclinedUp, Math.sin(angle) * radius, new Cesium.Cartesian3());
            return Cesium.Cartesian3.add(horizontalPart, verticalPart, new Cesium.Cartesian3());
        });
        const glow = (color, alpha, glowPower) => new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString(color).withAlpha(alpha), glowPower, taperPower: 1 });
        const startedAt = performance.now();
        const getCometIndex = () => Math.floor(((((performance.now() - startedAt) % 10_000) / 10_000 + 0.25) % 1) * pointCount);
        entities = [
            viewer.entities.add({ id: "orbit-welcome-trajectory", polyline: { positions: orbitPoints, width: 10, arcType: Cesium.ArcType.NONE, material: glow("#ef3f37", 0.52, 0.42) } }),
            viewer.entities.add({ id: "orbit-welcome-trajectory-core", polyline: { positions: orbitPoints, width: 2.4, arcType: Cesium.ArcType.NONE, material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString("#ff805e").withAlpha(0.96)) } }),
            viewer.entities.add({ id: "orbit-welcome-comet-tail", polyline: { positions: new Cesium.CallbackProperty(() => Array.from({ length: 20 }, (_, index) => orbitPoints[(getCometIndex() - 20 + index + pointCount) % pointCount]), false), width: 5.5, arcType: Cesium.ArcType.NONE, material: glow("#ff654f", 0.9, 0.45) } }),
            viewer.entities.add({ id: "orbit-welcome-comet", position: new Cesium.CallbackProperty(() => orbitPoints[getCometIndex()], false), point: { pixelSize: new Cesium.CallbackProperty(() => 15 + (Math.sin((performance.now() - startedAt) / 180) * 2), false), color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString("#ff5b4e"), outlineWidth: 5, disableDepthTestDistance: 0 } })
        ];
        updateGlobeLighting();
    };
    const teardown = () => {
        entities.forEach((entity) => viewer.entities.remove(entity));
        entities = [];
        if (!cameraActive) return;
        cameraActive = false;
        if (depthTestBefore !== null) { viewer.scene.globe.depthTestAgainstTerrain = depthTestBefore; depthTestBefore = null; }
        if (frustumOffsetsBefore) { viewer.camera.frustum.xOffset = frustumOffsetsBefore.x; viewer.camera.frustum.yOffset = frustumOffsetsBefore.y; frustumOffsetsBefore = null; }
        viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(0, 20, 20_000_000), duration: 0.8 });
    };
    return { setup, teardown };
}

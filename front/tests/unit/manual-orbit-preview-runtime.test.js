import assert from "node:assert/strict";
import test from "node:test";

import {
    clearManualOrbitPreview,
    getManualOrbitPreviewSnapshot,
    hideManualOrbitPreview,
    refreshSatelliteOverlays,
    renderManualOrbitPreview,
    setManualOrbitPreviewVectorVisualization,
    setManualOrbitPreviewGroundTrack,
    updateManualOrbitPreview
} from "../../js/satellites.js";

const previewPayload = {
    name: "Design preview",
    epoch: "2026-07-20T10:00:00Z",
    propagation: {
        start_time: "2026-07-20T09:00:00Z",
        end_time: "2026-07-20T11:00:00Z"
    },
    ephemeris: {
        points: [
            {
                time: "2026-07-20T11:00:00Z",
                position_ecef_m: { x: 7_020_000, y: 100_000, z: 0 }
            },
            {
                time: "2026-07-20T09:00:00Z",
                position_ecef_m: { x: 7_000_000, y: 0, z: 0 }
            },
            {
                time: "2026-07-20T10:00:00Z",
                position_ecef_m: { x: 7_010_000, y: 50_000, z: 0 }
            }
        ]
    }
};

test("manual orbit preview queues safely before a Cesium viewer exists", () => {
    clearManualOrbitPreview();

    const preview = renderManualOrbitPreview(previewPayload, { showGroundTrack: true });
    assert.equal(preview.id, "__manual-orbit-preview__");
    assert.equal(preview.pointCount, 3);
    assert.equal(preview.previewReferenceFrame, "eme2000");
    assert.equal(preview.visible, true);
    assert.equal(preview.rendered, false);
    assert.equal(preview.showGroundTrack, true);
    assert.equal(preview.epochTimeMs, Date.parse("2026-07-20T10:00:00Z"));
    assert.equal(preview.startTimeMs, Date.parse("2026-07-20T09:00:00Z"));
    assert.equal(preview.endTimeMs, Date.parse("2026-07-20T11:00:00Z"));

    const hidden = hideManualOrbitPreview();
    assert.equal(hidden.visible, false);
    assert.equal(hidden.pointCount, 3);

    const cleared = clearManualOrbitPreview();
    assert.equal(cleared.pointCount, 0);
    assert.equal(cleared.rendered, false);
});

test("manual orbit preview canonicalizes legacy ECI/ECEF preferences to EME2000/ITRF", () => {
    clearManualOrbitPreview();

    const inertial = renderManualOrbitPreview(previewPayload, { previewReferenceFrame: "eci" });
    assert.equal(inertial.previewReferenceFrame, "eme2000");

    const earthFixed = renderManualOrbitPreview(previewPayload, { previewReferenceFrame: "ecef" });
    assert.equal(earthFixed.previewReferenceFrame, "itrf");

    clearManualOrbitPreview();
});

test("manual orbit preview rejects invalid updates without discarding the current preview", () => {
    clearManualOrbitPreview();
    updateManualOrbitPreview(previewPayload);
    const before = getManualOrbitPreviewSnapshot();

    assert.throws(
        () => updateManualOrbitPreview({ ephemeris: { points: [{ time: "2026-07-20T10:00:00Z", x: 1, y: 2, z: 3 }] } }),
        /al menos dos muestras/i
    );

    const after = getManualOrbitPreviewSnapshot();
    assert.equal(after.pointCount, before.pointCount);
    assert.equal(after.epochTimeMs, before.epochTimeMs);
    clearManualOrbitPreview();
});

test("manual orbit preview owns and cleans up only its dedicated Cesium entities", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    globalThis.Cesium = {
        Cartesian3: class Cartesian3 {
            constructor(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }
        },
        ArcType: { NONE: "none" },
        Color: {
            WHITE: makeColor("white"),
            fromCssColorString: (value) => makeColor(value)
        },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) {
                Object.assign(this, options);
            }
        }
    };

    const added = [];
    const removed = [];
    const viewer = {
        entities: {
            add(entity) {
                added.push(entity);
                return entity;
            },
            remove(entity) {
                removed.push(entity);
                return true;
            }
        }
    };

    try {
        clearManualOrbitPreview();
        const preview = renderManualOrbitPreview(previewPayload, { viewer });
        assert.equal(preview.rendered, true);
        assert.deepEqual(added.map((entity) => entity.id), [
            "__manual-orbit-preview__-path",
            "__manual-orbit-preview__-epoch"
        ]);

        const cleared = clearManualOrbitPreview();
        assert.equal(cleared.pointCount, 0);
        assert.deepEqual(removed.map((entity) => entity.id), [
            "__manual-orbit-preview__-path",
            "__manual-orbit-preview__-epoch"
        ]);
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) {
            delete globalThis.Cesium;
        } else {
            globalThis.Cesium = previousCesium;
        }
    }
});

test("manual design vectors render as labelled arrow overlays for the active force model", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    const initialClockTime = { id: "simulation-start" };
    const laterClockTime = { id: "simulation-later" };
    const sunTimes = [];
    const moonTimes = [];
    const transformedTimes = [];
    class Cartesian3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        static magnitude(value) { return Math.hypot(value.x, value.y, value.z); }
        static divideByScalar(value, scalar, result) { result.x = value.x / scalar; result.y = value.y / scalar; result.z = value.z / scalar; return result; }
        static multiplyByScalar(value, scalar, result) { result.x = value.x * scalar; result.y = value.y * scalar; result.z = value.z * scalar; return result; }
        static add(left, right, result) { result.x = left.x + right.x; result.y = left.y + right.y; result.z = left.z + right.z; return result; }
        static negate(value, result) { result.x = -value.x; result.y = -value.y; result.z = -value.z; return result; }
        static normalize(value, result) { return this.divideByScalar(value, this.magnitude(value) || 1, result); }
        static cross(left, right, result) {
            result.x = (left.y * right.z) - (left.z * right.y);
            result.y = (left.z * right.x) - (left.x * right.z);
            result.z = (left.x * right.y) - (left.y * right.x);
            return result;
        }
    }
    class Matrix3 {
        static fromQuaternion() { return new Matrix3(); }
        static getColumn(_matrix, index, result) {
            result.x = index === 0 ? 1 : 0;
            result.y = index === 1 ? 1 : 0;
            result.z = index === 2 ? 1 : 0;
            return result;
        }
        static multiplyByVector(_matrix, vector, result) {
            result.x = vector.x + 100;
            result.y = vector.y + 200;
            result.z = vector.z + 300;
            return result;
        }
    }
    class CallbackProperty {
        constructor(callback) { this.callback = callback; }
    }
    class PolylineArrowMaterialProperty {
        constructor(color) { this.color = color; }
    }
    const added = [];
    const removed = [];
    globalThis.Cesium = {
        Cartesian3,
        Cartesian2: class Cartesian2 { constructor(x, y) { this.x = x; this.y = y; } },
        Matrix3,
        Quaternion: { IDENTITY: {}, fromRotationMatrix: () => ({}) },
        CallbackProperty,
        PolylineArrowMaterialProperty,
        ArcType: { NONE: "none" },
        Color: { WHITE: makeColor("white"), BLACK: makeColor("black"), fromCssColorString: (value) => makeColor(value) },
        JulianDate: {
            now: () => {
                throw new Error("Celestial arrows must use viewer.clock.currentTime");
            }
        },
        Simon1994PlanetaryPositions: {
            computeSunPositionInEarthInertialFrame(time, result) {
                sunTimes.push(time);
                result.x = 149_000_000_000;
                result.y = 1_000;
                result.z = 2_000;
                return result;
            },
            computeMoonPositionInEarthInertialFrame(time, result) {
                moonTimes.push(time);
                result.x = 384_000_000;
                result.y = 2_000;
                result.z = 3_000;
                return result;
            }
        },
        Transforms: {
            computeIcrfToFixedMatrix(time) {
                transformedTimes.push(time);
                return {};
            }
        },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty { constructor(options) { Object.assign(this, options); } }
    };
    const viewer = {
        clock: { currentTime: initialClockTime },
        entities: {
            add(entity) { added.push(entity); return entity; },
            remove(entity) { removed.push(entity); return true; }
        }
    };

    try {
        clearManualOrbitPreview();
        renderManualOrbitPreview(previewPayload, { viewer });
        setManualOrbitPreviewVectorVisualization(true, {
            stateVector: { velocityEciKmS: { x: 0, y: 7.5, z: 0 } },
            propagationOptions: { forceTerms: ["central", "drag"] }
        });

        const vectors = added.filter((entity) => String(entity.id).startsWith("__manual-orbit-preview__-vectors-"));
        assert.deepEqual(vectors.map((entity) => entity.label.text), ["X", "Y", "Z", "v", "Sol", "Luna", "F CENTRAL", "F DRAG"]);
        assert.ok(vectors.every((entity) => entity.polyline.material instanceof PolylineArrowMaterialProperty));
        assert.ok(vectors.every((entity) => entity.label.font === "10px sans-serif"));

        const sunArrow = vectors.find((entity) => entity.label.text === "Sol");
        const moonArrow = vectors.find((entity) => entity.label.text === "Luna");
        sunArrow.polyline.positions.callback();
        moonArrow.polyline.positions.callback();
        viewer.clock.currentTime = laterClockTime;
        sunArrow.polyline.positions.callback();
        assert.deepEqual(sunTimes, [initialClockTime, laterClockTime]);
        assert.deepEqual(moonTimes, [initialClockTime]);
        assert.deepEqual(transformedTimes, [initialClockTime, initialClockTime, laterClockTime]);

        setManualOrbitPreviewVectorVisualization(false);
        assert.equal(removed.filter((entity) => String(entity.id).startsWith("__manual-orbit-preview__-vectors-")).length, 8);
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) delete globalThis.Cesium;
        else globalThis.Cesium = previousCesium;
    }
});

test("manual orbit design preview renders one epoch-anchored inertial ellipse, never the long ITRF rosette", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    const added = [];
    globalThis.Cesium = {
        Cartesian3: class Cartesian3 {
            constructor(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }

            static fromRadians(longitude, latitude, height) {
                return new this(longitude, latitude, height);
            }
        },
        ArcType: { NONE: "none", GEODESIC: "geodesic" },
        Cartographic: {
            fromCartesian: ({ x, y, z }) => ({
                longitude: Math.atan2(y, x),
                latitude: Math.atan2(z, Math.hypot(x, y))
            })
        },
        Color: { WHITE: makeColor("white"), fromCssColorString: (value) => makeColor(value) },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) {
                Object.assign(this, options);
            }
        }
    };
    const viewer = {
        entities: {
            add(entity) {
                added.push(entity);
                return entity;
            },
            remove() {
                return true;
            }
        }
    };

    try {
        clearManualOrbitPreview();
        const longRangePayload = {
            ...previewPayload,
            keplerian: {
                semi_major_axis_km: 26099,
                eccentricity: 0.137,
                inclination_deg: 91,
                raan_deg: 0,
                argument_of_perigee_deg: 0,
                true_anomaly_deg: 49
            }
        };

        const preview = renderManualOrbitPreview(longRangePayload, { viewer, showGroundTrack: true });
        assert.equal(preview.previewReferenceFrame, "eme2000");
        assert.equal(preview.geometryMode, "inertial-osculating-ellipse");
        assert.equal(preview.pointCount, 721);
        assert.equal(preview.showGroundTrack, true);
        assert.deepEqual(added.map((entity) => entity.id), [
            "__manual-orbit-preview__-path",
            "__manual-orbit-preview__-epoch",
            "__manual-orbit-preview__-ground-track"
        ]);
        const positions = added[0].polyline.positions;
        assert.equal(positions.length, 721);
        assert.equal(added[0].polyline.arcType, "none");
        // The visual orbit remains the epoch-anchored EME2000 ellipse, while the
        // ground path deliberately uses the physical ITRF samples returned
        // by the propagation service. That lets the 2D map stay a real Earth
        // projection instead of flattening an inertial ellipse.
        assert.equal(added[2].polyline.positions.length, 3);
        assert.equal(added[2].polyline.arcType, "geodesic");
        const first = positions[0];
        const last = positions[positions.length - 1];
        assert.ok(Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < 0.001);

        const after = getManualOrbitPreviewSnapshot();
        assert.equal(after.startTimeMs, Date.parse("2026-07-20T09:00:00Z"));
        assert.equal(after.endTimeMs, Date.parse("2026-07-20T11:00:00Z"));
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) {
            delete globalThis.Cesium;
        } else {
            globalThis.Cesium = previousCesium;
        }
    }
});

test("J2 EME2000 preview uses the backend native samples and projects its ground track from that same trajectory", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    const added = [];
    globalThis.Cesium = {
        Cartesian3: class Cartesian3 {
            constructor(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }

            static fromRadians(longitude, latitude, height) {
                return new this(longitude, latitude, height);
            }
        },
        ArcType: { NONE: "none", GEODESIC: "geodesic" },
        Cartographic: {
            fromCartesian: ({ x, y, z }) => ({
                longitude: Math.atan2(y, x),
                latitude: Math.atan2(z, Math.hypot(x, y))
            })
        },
        Color: { WHITE: makeColor("white"), fromCssColorString: (value) => makeColor(value) },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) {
                Object.assign(this, options);
            }
        }
    };
    const viewer = {
        entities: {
            add(entity) {
                added.push(entity);
                return entity;
            },
            remove() {
                return true;
            }
        }
    };
    const j2Payload = {
        ...previewPayload,
        // Exercise an accepted server alias as well as the canonical response
        // normalizer. A static Kepler ellipse would have 721 points here.
        propagator: "j2-analytic",
        keplerian: {
            semi_major_axis_km: 26099,
            eccentricity: 0.137,
            inclination_deg: 91,
            raan_deg: 0,
            argument_of_perigee_deg: 0,
            true_anomaly_deg: 49
        },
        propagation: {
            ...previewPayload.propagation
        },
        ephemeris: {
            eci_samples_available: true,
            points: [
                {
                    time: "2026-07-20T09:00:00Z",
                    position_ecef_m: { x: 7_000_000, y: 0, z: 0 },
                    eci: {
                        reference_frame: "ECI",
                        position_units: "m",
                        position: { x: 7_000_000, y: 0, z: 0 }
                    }
                },
                {
                    time: "2026-07-20T10:00:00Z",
                    position_ecef_m: { x: 0, y: 7_100_000, z: 1_000 },
                    eci: {
                        reference_frame: "ECI",
                        position_units: "m",
                        position: { x: 0, y: 7_100_000, z: 1_000 }
                    }
                },
                {
                    time: "2026-07-20T11:00:00Z",
                    position_ecef_m: { x: -7_200_000, y: 0, z: 2_000 },
                    eci: {
                        reference_frame: "ECI",
                        position_units: "m",
                        position: { x: -7_200_000, y: 0, z: 2_000 }
                    }
                }
            ]
        }
    };

    try {
        clearManualOrbitPreview();
        const preview = renderManualOrbitPreview(j2Payload, { viewer, showGroundTrack: true });
        assert.equal(preview.previewReferenceFrame, "eme2000");
        assert.equal(preview.geometryMode, "inertial-eci-ephemeris");
        assert.equal(preview.pointCount, 3);
        assert.deepEqual(added.map((entity) => entity.id), [
            "__manual-orbit-preview__-path",
            "__manual-orbit-preview__-epoch",
            "__manual-orbit-preview__-ground-track"
        ]);

        const pathPositions = added[0].polyline.positions;
        assert.equal(pathPositions.length, 3);
        // The fixed epoch rotation preserves each backend EME2000 radius; the
        // values prove the renderer did not replace them with a static ellipse.
        assert.ok(Math.abs(Math.hypot(pathPositions[0].x, pathPositions[0].y, pathPositions[0].z) - 7_000_000) < 1e-6);
        assert.ok(Math.abs(Math.hypot(pathPositions[2].x, pathPositions[2].y, pathPositions[2].z) - Math.hypot(7_200_000, 0, 2_000)) < 1e-6);
        assert.equal(added[1].position.x, pathPositions[1].x);
        assert.equal(added[1].position.y, pathPositions[1].y);
        assert.equal(added[1].position.z, pathPositions[1].z);
        assert.equal(added[2].polyline.positions.length, 3);
        assert.equal(added[2].polyline.arcType, "geodesic");
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) {
            delete globalThis.Cesium;
        } else {
            globalThis.Cesium = previousCesium;
        }
    }
});

test("manual preview uses native EME2000 samples only for supported native models and otherwise keeps its ellipse fallback", () => {
    const keplerian = {
        semi_major_axis_km: 26099,
        eccentricity: 0.137,
        inclination_deg: 91,
        raan_deg: 0,
        argument_of_perigee_deg: 0,
        true_anomaly_deg: 49
    };
    const eciPoints = [
        { time: "2026-07-20T09:00:00Z", x: 7_000_000, y: 0, z: 0 },
        { time: "2026-07-20T10:00:00Z", x: 0, y: 7_100_000, z: 1_000 }
    ];

    try {
        clearManualOrbitPreview();
        const legacyJ2 = renderManualOrbitPreview({
            ...previewPayload,
            propagator: "j2",
            keplerian
        });
        assert.equal(legacyJ2.geometryMode, "inertial-osculating-ellipse");
        assert.equal(legacyJ2.pointCount, 721);

        clearManualOrbitPreview();
        const twoBody = renderManualOrbitPreview({
            ...previewPayload,
            propagator: "two_body",
            keplerian,
            ephemeris: {
                points: previewPayload.ephemeris.points.map((point, index) => ({
                    ...point,
                    eci: {
                        reference_frame: "ECI",
                        position_units: "m",
                        position: eciPoints[index] || eciPoints.at(-1)
                    }
                }))
            }
        });
        assert.equal(twoBody.geometryMode, "inertial-eci-ephemeris");
        assert.equal(twoBody.pointCount, 3);

        clearManualOrbitPreview();
        const alternateJ2 = renderManualOrbitPreview({
            ...previewPayload,
            propagator: "j2",
            keplerian,
            eciPoints
        });
        assert.equal(alternateJ2.geometryMode, "inertial-eci-ephemeris");
        assert.equal(alternateJ2.pointCount, 2);

        clearManualOrbitPreview();
        const higherOrderGravity = renderManualOrbitPreview({
            ...previewPayload,
            propagator: "J2 + J3 + J4",
            keplerian,
            eciPoints
        });
        assert.equal(higherOrderGravity.geometryMode, "inertial-eci-ephemeris");
        assert.equal(higherOrderGravity.pointCount, 2);

        clearManualOrbitPreview();
        const sgp4 = renderManualOrbitPreview({
            ...previewPayload,
            propagator: "sgp4",
            keplerian,
            eciPoints
        });
        assert.equal(sgp4.geometryMode, "inertial-osculating-ellipse");
        assert.equal(sgp4.pointCount, 721);
    } finally {
        clearManualOrbitPreview();
    }
});

test("manual orbit preview toggles its ground track immediately without re-propagating", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    const added = [];
    const removed = [];
    globalThis.Cesium = {
        Cartesian3: class Cartesian3 {
            constructor(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }

            static fromRadians(longitude, latitude, height) {
                return new this(longitude, latitude, height);
            }
        },
        ArcType: { NONE: "none" },
        Cartographic: {
            fromCartesian: ({ x, y, z }) => ({
                longitude: Math.atan2(y, x),
                latitude: Math.atan2(z, Math.hypot(x, y))
            })
        },
        Color: { WHITE: makeColor("white"), fromCssColorString: (value) => makeColor(value) },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) {
                Object.assign(this, options);
            }
        }
    };
    const viewer = {
        entities: {
            add(entity) {
                added.push(entity);
                return entity;
            },
            remove(entity) {
                removed.push(entity);
                return true;
            }
        }
    };

    try {
        clearManualOrbitPreview();
        renderManualOrbitPreview(previewPayload, { viewer, showGroundTrack: false });
        assert.deepEqual(added.map((entity) => entity.id), [
            "__manual-orbit-preview__-path",
            "__manual-orbit-preview__-epoch"
        ]);

        const shown = setManualOrbitPreviewGroundTrack(true, { viewer });
        assert.equal(shown.showGroundTrack, true);
        assert.equal(added.at(-1).id, "__manual-orbit-preview__-ground-track");
        // Older/minimal Cesium integrations without ArcType.GEODESIC still
        // render safely through the compatible NONE fallback.
        assert.equal(added.at(-1).polyline.arcType, "none");

        const hidden = setManualOrbitPreviewGroundTrack(false, { viewer });
        assert.equal(hidden.showGroundTrack, false);
        assert.equal(removed.at(-1).id, "__manual-orbit-preview__-ground-track");
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) {
            delete globalThis.Cesium;
        } else {
            globalThis.Cesium = previousCesium;
        }
    }
});

test("manual preview replaces the spatial orbit with its ITRF projection in 2D and uses Ground Track for the visibility circle", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    const added = [];
    const removed = [];
    const earthRadius = 6_378_137;
    globalThis.Cesium = {
        Cartesian3: class Cartesian3 {
            constructor(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }

            static fromRadians(longitude, latitude, height) {
                return new this(longitude, latitude, height);
            }
        },
        SceneMode: { SCENE2D: "2d" },
        ArcType: { NONE: "none", GEODESIC: "geodesic" },
        Math: { TWO_PI: 2 * Math.PI },
        Ellipsoid: { WGS84: { maximumRadius: earthRadius } },
        PolygonHierarchy: class PolygonHierarchy {
            constructor(positions) { this.positions = positions; }
        },
        Cartographic: {
            fromCartesian: ({ x, y, z }) => {
                const radius = Math.hypot(x, y, z);
                return {
                    longitude: Math.atan2(y, x),
                    latitude: Math.atan2(z, Math.hypot(x, y)),
                    height: radius - earthRadius
                };
            }
        },
        Color: { WHITE: makeColor("white"), fromCssColorString: (value) => makeColor(value) },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) { Object.assign(this, options); }
        }
    };
    const viewer = {
        scene: { mode: "2d" },
        entities: {
            add(entity) {
                added.push(entity);
                return entity;
            },
            remove(entity) {
                removed.push(entity);
                return true;
            }
        }
    };
    const payload = {
        ...previewPayload,
        propagator: "two-body",
        ephemeris: {
            points: previewPayload.ephemeris.points.map((point, index) => ({
                ...point,
                eci: {
                    reference_frame: "EME2000",
                    position_units: "m",
                    position: index === 0
                        ? { x: 0, y: 7_200_000, z: 0 }
                        : index === 1
                            ? { x: 7_300_000, y: 0, z: 0 }
                            : { x: 0, y: -7_400_000, z: 0 }
                }
            }))
        }
    };

    try {
        clearManualOrbitPreview();
        const preview = renderManualOrbitPreview(payload, { viewer, showGroundTrack: false });
        assert.equal(preview.hasSurfaceEphemeris, true);
        assert.deepEqual(added.map((entity) => entity.id), [
            "__manual-orbit-preview__-path",
            "__manual-orbit-preview__-epoch",
            "__manual-orbit-preview__-ground-track"
        ]);
        assert.equal(added[0].show, false);
        // The epoch marker and map trace use the real ITRF ephemeris, not
        // the EME2000 path selected for the 3D design preview.
        assert.equal(added[1].position.x, 7_010_000);
        assert.equal(added[1].position.y, 50_000);
        assert.equal(added[1].position.z, 0);
        assert.ok(Math.abs(added[2].polyline.positions[0].x) < 1e-12);
        assert.equal(added.some((entity) => entity.id.endsWith("-footprint")), false);

        setManualOrbitPreviewGroundTrack(true, { viewer });
        assert.equal(added.at(-1).id, "__manual-orbit-preview__-footprint");
        assert.ok(added.at(-1).polygon.hierarchy.positions.length > 100);

        viewer.scene.mode = "3d";
        refreshSatelliteOverlays(viewer);
        assert.equal(added[0].show, true);
        assert.equal(removed.at(-1).id, "__manual-orbit-preview__-footprint");
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) {
            delete globalThis.Cesium;
        } else {
            globalThis.Cesium = previousCesium;
        }
    }
});

test("manual orbit preview renders its path and ground track from raw propagated samples when ITRF is selected", () => {
    const previousCesium = globalThis.Cesium;
    const makeColor = (value) => ({ value, withAlpha: (alpha) => makeColor(`${value}:${alpha}`) });
    const added = [];
    globalThis.Cesium = {
        Cartesian3: class Cartesian3 {
            constructor(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }

            static fromRadians(longitude, latitude, height) {
                return new this(longitude, latitude, height);
            }
        },
        ArcType: { NONE: "none", GEODESIC: "geodesic" },
        Cartographic: {
            fromCartesian: ({ x, y, z }) => ({
                longitude: Math.atan2(y, x),
                latitude: Math.atan2(z, Math.hypot(x, y))
            })
        },
        Color: { WHITE: makeColor("white"), fromCssColorString: (value) => makeColor(value) },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) {
                Object.assign(this, options);
            }
        }
    };
    const viewer = {
        entities: {
            add(entity) {
                added.push(entity);
                return entity;
            },
            remove() {
                return true;
            }
        }
    };
    const payload = {
        ...previewPayload,
        keplerian: {
            semi_major_axis_km: 26099,
            eccentricity: 0.137,
            inclination_deg: 91,
            raan_deg: 0,
            argument_of_perigee_deg: 0,
            true_anomaly_deg: 49
        }
    };

    try {
        clearManualOrbitPreview();
        const preview = renderManualOrbitPreview(payload, {
            viewer,
            showGroundTrack: true,
            previewReferenceFrame: "itrf"
        });
        assert.equal(preview.previewReferenceFrame, "itrf");
        assert.equal(preview.geometryMode, "earth-fixed-ephemeris");
        assert.equal(preview.pointCount, 3);
        assert.equal(added[0].polyline.positions.length, 3);
        assert.equal(added[2].polyline.positions.length, 3);
        assert.equal(added[2].polyline.arcType, "geodesic");
    } finally {
        clearManualOrbitPreview();
        if (previousCesium === undefined) {
            delete globalThis.Cesium;
        } else {
            globalThis.Cesium = previousCesium;
        }
    }
});

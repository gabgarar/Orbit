import assert from "node:assert/strict";
import test from "node:test";

import {
    clearManualOrbitPreview,
    getManualOrbitPreviewSnapshot,
    hideManualOrbitPreview,
    renderManualOrbitPreview,
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
                position_ecef_m: { x: 7_020_000, y: 0, z: 0 }
            },
            {
                time: "2026-07-20T09:00:00Z",
                position_ecef_m: { x: 7_000_000, y: 0, z: 0 }
            },
            {
                time: "2026-07-20T10:00:00Z",
                position_ecef_m: { x: 7_010_000, y: 0, z: 0 }
            }
        ]
    }
};

test("manual orbit preview queues safely before a Cesium viewer exists", () => {
    clearManualOrbitPreview();

    const preview = renderManualOrbitPreview(previewPayload, { showGroundTrack: true });
    assert.equal(preview.id, "__manual-orbit-preview__");
    assert.equal(preview.pointCount, 3);
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
        assert.equal(preview.previewReferenceFrame, "eci");
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
        // In ECI mode the path is a static epoch ellipse, but a ground track
        // must use the raw, time-stamped ITRF samples rather than projecting
        // that ellipse onto the Earth.
        assert.equal(added[2].polyline.positions.length, 3);
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

test("manual orbit preview renders the raw propagated path when ECEF is selected", () => {
    clearManualOrbitPreview();
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
        const preview = renderManualOrbitPreview(payload, { previewReferenceFrame: "ecef" });
        assert.equal(preview.previewReferenceFrame, "ecef");
        assert.equal(preview.geometryMode, "earth-fixed-ephemeris");
        assert.equal(preview.pointCount, 3);
    } finally {
        clearManualOrbitPreview();
    }
});

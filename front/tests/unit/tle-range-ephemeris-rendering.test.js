import assert from "node:assert/strict";
import test from "node:test";

import {
    getObjectMtrStatus,
    getSatelliteEntity,
    hydrateCatalogEntries,
    initSatelliteReceiver,
    refreshSatelliteOverlays,
    setOrbitConfig,
    setSatelliteLayerActive,
    setSimulationTimelineProvider
} from "../../js/satellites.js";

function color(value) {
    return {
        value,
        withAlpha(alpha) {
            return color(`${value}:${alpha}`);
        }
    };
}

function cesiumDouble() {
    return {
        Cartesian3: class Cartesian3 {
            constructor(x = 0, y = 0, z = 0) {
                this.x = x;
                this.y = y;
                this.z = z;
            }
        },
        Cartesian2: class Cartesian2 {
            constructor(x = 0, y = 0) {
                this.x = x;
                this.y = y;
            }
        },
        Quaternion: { IDENTITY: {} },
        ArcType: { NONE: "none", GEODESIC: "geodesic" },
        PolylineGlowMaterialProperty: class PolylineGlowMaterialProperty {
            constructor(options) {
                Object.assign(this, options);
            }
        },
        ModelGraphics: class ModelGraphics {
            constructor(options) {
                Object.assign(this, options);
            }
        },
        LabelStyle: { FILL_AND_OUTLINE: "fill-and-outline" },
        Color: {
            WHITE: color("white"),
            BLACK: color("black"),
            fromCssColorString: (value) => color(value)
        }
    };
}

test("the renderer requests a local post-epoch TLE segment instead of the mixed scene envelope", async () => {
    const previous = {
        Cesium: globalThis.Cesium,
        window: globalThis.window,
        WebSocket: globalThis.WebSocket,
        fetch: globalThis.fetch,
        requestAnimationFrame: globalThis.requestAnimationFrame
    };
    const id = "tle-local-window-regression";
    const requests = [];
    const entities = [];
    let scheduledFrame = null;
    let playhead = new Date("2026-08-23T10:03:42.000Z");

    class TestWebSocket {
        static OPEN = 1;
        static latest = null;

        constructor() {
            this.readyState = TestWebSocket.OPEN;
            TestWebSocket.latest = this;
        }

        send() {}
        close() {}
    }

    try {
        globalThis.Cesium = cesiumDouble();
        globalThis.window = { location: { protocol: "http:", host: "orbit.test" } };
        globalThis.WebSocket = TestWebSocket;
        globalThis.requestAnimationFrame = (callback) => {
            scheduledFrame = callback;
            return 0;
        };
        globalThis.fetch = async (url, options) => {
            requests.push({ url, options });
            const request = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    reference_frame: "ITRF",
                    points: [
                        { time: request.start_time, position: { x: 7_000_000, y: 0, z: 0 } },
                        { time: request.end_time, position: { x: 7_010_000, y: 10_000, z: 0 } }
                    ]
                })
            };
        };

        const viewer = {
            entities: {
                add(entity) {
                    entities.push(entity);
                    return entity;
                },
                remove(entity) {
                    const index = entities.indexOf(entity);
                    if (index >= 0) entities.splice(index, 1);
                    return true;
                }
            }
        };
        setOrbitConfig({
            satellite_use_3d_model: false,
            orbit_future_show: true,
            orbit_ground_track_show: false,
            propagation_hours: 12
        });
        setSimulationTimelineProvider(() => ({
            mode: "range",
            // This playhead is after the TLE epoch, but the scene starts at
            // an old SP3 interval and deliberately contains a long gap.
            date: playhead,
            rangeStart: new Date("2025-05-10T00:00:00.000Z"),
            rangeEnd: new Date("2026-08-25T00:00:00.000Z")
        }));
        hydrateCatalogEntries([{
            name: id,
            catalogId: id,
            sourceFormat: "TLE",
            // 2026 day 232 = 20 August; it is intentionally later than the
            // historical SP3 range above.
            line1: "1 25544U 98067A   26232.00000000  .00000000  00000+0  00000+0 0  9991",
            line2: "2 25544  51.6400  10.0000 0005000  30.0000 330.0000 15.50000000000000"
        }]);
        initSatelliteReceiver(viewer);
        assert.equal(setSatelliteLayerActive(id, true), true);

        await TestWebSocket.latest.onmessage({
            data: JSON.stringify({
                satellite: id,
                position: { x: 7_000_000, y: 0, z: 0 },
                velocity: { x: 0, y: 7_500, z: 0 },
                orbit: [
                    { x: 7_000_000, y: 0, z: 0 },
                    { x: 7_010_000, y: 10_000, z: 0 }
                ]
            })
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The active local segment is followed by one quiet adjacent warmup.
        // It remains bounded and is never propagated from the historical SP3
        // coverage at the beginning of the mixed scene envelope.
        assert.equal(requests.length, 2);
        assert.equal(requests[0].url, "/api/ephemeris");
        const body = JSON.parse(requests[0].options.body);
        assert.equal(body.start_time, "2026-08-23T10:00:00.000Z");
        assert.equal(body.end_time, "2026-08-23T22:00:00.000Z");
        assert.ok(
            Date.parse(body.start_time) > Date.parse("2025-05-10T00:00:00.000Z"),
            "the TLE must not be propagated from the old SP3 start"
        );
        assert.ok(
            Date.parse(body.start_time) >= Date.parse("2026-08-20T00:00:00.000Z"),
            "the request must never predate the TLE epoch"
        );
        const prefetchedBody = JSON.parse(requests[1].options.body);
        assert.equal(prefetchedBody.start_time, "2026-08-23T22:00:00.000Z");
        assert.equal(prefetchedBody.end_time, "2026-08-24T10:00:00.000Z");

        // Crossing into the next segment consumes the cache warmup. It must
        // not launch a second foreground fetch for the near-identical
        // five-minute playhead key.
        playhead = new Date("2026-08-23T23:03:42.000Z");
        assert.equal(typeof scheduledFrame, "function");
        scheduledFrame();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(requests.length, 3);
        const successorBody = JSON.parse(requests[2].options.body);
        assert.equal(successorBody.start_time, "2026-08-24T10:00:00.000Z");
        assert.equal(successorBody.end_time, "2026-08-24T22:00:00.000Z");

        // Going back freely before the epoch remains navigation, not a
        // request for backwards SGP4 propagation. The selected TLE is visibly
        // out of time until the playhead returns to its own availability.
        playhead = new Date("2026-08-19T12:00:00.000Z");
        refreshSatelliteOverlays(viewer);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(requests.length, 3);
        assert.equal(getObjectMtrStatus(id, playhead).reason, "before-tle-epoch");
        assert.equal(getSatelliteEntity(id)?.show, false);
    } finally {
        setSatelliteLayerActive(id, false);
        setSimulationTimelineProvider(null);
        setOrbitConfig({
            satellite_use_3d_model: true,
            orbit_future_show: true,
            orbit_ground_track_show: true,
            propagation_hours: 12
        });
        for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[name];
            else globalThis[name] = value;
        }
    }
});

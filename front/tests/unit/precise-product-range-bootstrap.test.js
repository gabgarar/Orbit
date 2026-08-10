import assert from "node:assert/strict";
import test from "node:test";

import {
    getSatelliteTelemetry,
    initSatelliteReceiver,
    registerPreciseProductSatelliteEntries,
    setOrbitConfig,
    setSatelliteLayerActive,
    setSimulationTimelineProvider
} from "../../js/satellites.js";

function makeColor(value) {
    return {
        value,
        withAlpha(alpha) {
            return makeColor(`${value}:${alpha}`);
        }
    };
}

function createCesiumTestDouble() {
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
        ModelGraphics: class ModelGraphics {
            constructor(options) {
                Object.assign(this, options);
            }
        },
        LabelStyle: { FILL_AND_OUTLINE: "fill-and-outline" },
        Color: {
            WHITE: makeColor("white"),
            BLACK: makeColor("black"),
            fromCssColorString: (value) => makeColor(value)
        },
        Math: { toDegrees: (radians) => radians * (180 / Math.PI) },
        Cartographic: {
            fromCartesian: () => ({ latitude: 0, longitude: 0, height: 700_000 })
        },
        Ellipsoid: { WGS84: { maximumRadius: 6_378_137 } }
    };
}

test("an active historical SP3 layer seeds Cesium from its aligned range instead of realtime", async () => {
    const previous = {
        Cesium: globalThis.Cesium,
        window: globalThis.window,
        WebSocket: globalThis.WebSocket,
        fetch: globalThis.fetch,
        requestAnimationFrame: globalThis.requestAnimationFrame
    };
    const requests = [];
    const stationId = "precise:igs-final:GPS01";

    class TestWebSocket {
        static OPEN = 1;

        constructor(url) {
            this.url = url;
            this.readyState = 0;
        }

        close() {}
        send() {}
    }

    const entities = [];
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

    try {
        globalThis.Cesium = createCesiumTestDouble();
        globalThis.window = { location: { protocol: "http:", host: "orbit.test" } };
        globalThis.WebSocket = TestWebSocket;
        globalThis.requestAnimationFrame = () => 0;
        globalThis.fetch = async (url, options) => {
            requests.push({ url, options });
            return {
                ok: true,
                json: async () => ({
                    reference_frame: "ITRF",
                    points: [
                        {
                            time: "2026-08-10T12:00:00.000Z",
                            position: { x: 7_000_000, y: 0, z: 0 }
                        },
                        {
                            time: "2026-08-10T12:01:00.000Z",
                            position: { x: 7_100_000, y: 60_000, z: 0 }
                        }
                    ]
                })
            };
        };

        // Keep this regression focused on state seeding. Orbit/ground-track
        // geometries are covered elsewhere and are deliberately disabled in
        // this minimal Cesium double.
        setOrbitConfig({
            satellite_use_3d_model: false,
            orbit_future_show: false,
            orbit_ground_track_show: false,
            propagation_hours: 0
        });
        setSimulationTimelineProvider(() => ({
            mode: "range",
            date: new Date("2026-08-10T12:00:30.000Z"),
            rangeStart: new Date("2026-08-10T12:00:00.000Z"),
            rangeEnd: new Date("2026-08-10T12:01:00.000Z")
        }));
        registerPreciseProductSatelliteEntries([{
            id: stationId,
            name: "GPS 01",
            sourceFormat: "SP3",
            satellite_id: "G01",
            product_id: "igs-final",
            sp3: { reference_frame: "ITRF", time_scale: "GPS" }
        }]);
        initSatelliteReceiver(viewer);

        // There is intentionally no WebSocket state message. A historical
        // product is unavailable at realtime `now`, but is valid inside this
        // selected range and must render from /api/ephemeris.
        assert.equal(setSatelliteLayerActive(stationId, true), true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "/api/ephemeris");
        const body = JSON.parse(requests[0].options.body);
        assert.deepEqual({
            sat_id: body.sat_id,
            start_time: body.start_time,
            end_time: body.end_time
        }, {
            sat_id: stationId,
            start_time: "2026-08-10T12:00:00.000Z",
            end_time: "2026-08-10T12:01:00.000Z"
        });

        const telemetry = getSatelliteTelemetry(stationId);
        assert.ok(telemetry, "the aligned ephemeris creates a Cesium-backed state");
        assert.equal(telemetry.source_format, "SP3");
        assert.equal(telemetry.position_frame, "ITRF");
        assert.equal(telemetry.runtime_state, "ACTIVE");
        assert.equal(telemetry.position.x, 7_050_000, "the marker is sampled at the selected timeline time");
        assert.equal(telemetry.position.y, 30_000);
    } finally {
        setSatelliteLayerActive(stationId, false);
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

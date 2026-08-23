import assert from "node:assert/strict";
import test from "node:test";

import {
    getObjectMtrStatus,
    getSatelliteTelemetry,
    initSatelliteReceiver,
    refreshSatelliteOverlays,
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

            static fromRadians(longitude, latitude, height) {
                if (![longitude, latitude, height].every(Number.isFinite)) {
                    throw new TypeError("Cannot read properties of undefined (reading 'longitude')");
                }
                return new this(longitude, latitude, height);
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
            WHITE: makeColor("white"),
            BLACK: makeColor("black"),
            fromCssColorString: (value) => makeColor(value)
        },
        Math: { toDegrees: (radians) => radians * (180 / Math.PI) },
        Cartographic: {
            fromCartesian: () => ({ latitude: 0, longitude: 0, height: 700_000 })
        },
        Ellipsoid: { WGS84: { maximumRadius: 6_378_137 } },
        PolygonHierarchy: class PolygonHierarchy {
            constructor(positions) {
                this.positions = positions;
            }
        }
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
            sp3: {
                reference_frame: "ITRF",
                time_scale: "GPS",
                start_time: "2026-08-10T12:00:00.000Z",
                end_time: "2026-08-10T12:01:00.000Z"
            }
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

        // A product can have an aligned range but no projectable geodetic
        // state (for example while a renderer realization is unavailable or
        // an incomplete state is being replaced). The object inspector must
        // keep the Cartesian telemetry and omit only geodetic fields.
        globalThis.Cesium.Cartographic.fromCartesian = () => ({
            latitude: 0,
            height: 700_000
        });
        assert.doesNotThrow(() => getSatelliteTelemetry(stationId));
        const unprojectableTelemetry = getSatelliteTelemetry(stationId);
        assert.deepEqual(unprojectableTelemetry.geo, {
            latitude_deg: null,
            longitude_deg: null,
            altitude_m: null
        });
        assert.equal(unprojectableTelemetry.footprint_radius_m, null);

        // The same incomplete state must be harmless when surface overlays
        // refresh: no footprint is created and the remaining orbit state is
        // still usable by the inspector.
        setOrbitConfig({
            satellite_use_3d_model: false,
            orbit_future_show: false,
            orbit_ground_track_show: true,
            propagation_hours: 1
        });
        assert.doesNotThrow(() => refreshSatelliteOverlays(viewer));
        assert.equal(entities.some((entity) => entity.id === `${stationId}-footprint`), false);

        // Some Cesium builds reject an intermediate Cartesian conversion
        // outright. Keep that recovery boundary local to the optional
        // cartographic representation as well.
        globalThis.Cesium.Cartographic.fromCartesian = () => {
            throw new TypeError("Cannot read properties of undefined (reading 'longitude')");
        };
        assert.doesNotThrow(() => getSatelliteTelemetry(stationId));
        assert.doesNotThrow(() => refreshSatelliteOverlays(viewer));
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

test("a multi-satellite SP3 import bounds exact-range requests while every layer remains activatable", async () => {
    const previous = {
        Cesium: globalThis.Cesium,
        window: globalThis.window,
        WebSocket: globalThis.WebSocket,
        fetch: globalThis.fetch,
        requestAnimationFrame: globalThis.requestAnimationFrame
    };
    const ids = Array.from({ length: 6 }, (_, index) => `precise:queue-test:G${String(index + 1).padStart(2, "0")}`);
    const responseResolvers = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let requestCount = 0;

    class TestWebSocket {
        static OPEN = 1;

        constructor() {
            this.readyState = 0;
        }

        close() {}
        send() {}
    }

    const viewer = {
        entities: {
            add(entity) { return entity; },
            remove() { return true; }
        }
    };
    const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
    const response = {
        ok: true,
        json: async () => ({
            reference_frame: "ITRF",
            points: [
                { time: "2026-08-10T12:00:00.000Z", position: { x: 7_000_000, y: 0, z: 0 } },
                { time: "2026-08-10T12:01:00.000Z", position: { x: 7_100_000, y: 60_000, z: 0 } }
            ]
        })
    };

    try {
        globalThis.Cesium = createCesiumTestDouble();
        globalThis.window = { location: { protocol: "http:", host: "orbit.test" } };
        globalThis.WebSocket = TestWebSocket;
        // The bootstrap itself is promise-driven. Do not start the renderer's
        // perpetual animation loop in this unit test.
        globalThis.requestAnimationFrame = () => 0;
        globalThis.fetch = () => {
            requestCount += 1;
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            return new Promise((resolve) => {
                responseResolvers.push(() => {
                    inFlight -= 1;
                    resolve(response);
                });
            });
        };

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
        registerPreciseProductSatelliteEntries(ids.map((id) => ({
            id,
            name: id.slice(-3),
            sourceFormat: "SP3",
            satellite_id: id.slice(-3),
            product_id: "queue-test",
            sp3: {
                reference_frame: "ITRF",
                time_scale: "GPS",
                start_time: "2026-08-10T12:00:00.000Z",
                end_time: "2026-08-10T12:01:00.000Z"
            }
        })));
        initSatelliteReceiver(viewer);

        ids.forEach((id) => assert.equal(setSatelliteLayerActive(id, true), true));
        await nextTask();
        await nextTask();

        assert.equal(inFlight, 4, "only four SP3 range requests start together");
        assert.equal(maxInFlight, 4);

        for (let attempt = 0; attempt < 32 && requestCount < ids.length; attempt += 1) {
            const release = responseResolvers.shift();
            if (release) release();
            await nextTask();
            await nextTask();
        }
        while (responseResolvers.length) {
            responseResolvers.shift()();
            await nextTask();
            await nextTask();
        }

        assert.equal(requestCount, ids.length, "every selected SP3 member eventually receives its exact range");
        assert.equal(maxInFlight, 4, "the queue never floods the ephemeris endpoint");
    } finally {
        ids.forEach((id) => setSatelliteLayerActive(id, false));
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

test("an SP3 Earth-centre missing-state record never reaches Cesium orbit geometry", async () => {
    const previous = {
        Cesium: globalThis.Cesium,
        window: globalThis.window,
        WebSocket: globalThis.WebSocket,
        fetch: globalThis.fetch,
        requestAnimationFrame: globalThis.requestAnimationFrame
    };
    const stationId = "precise:missing-state:C08";
    const entities = [];
    let socket = null;

    class TestWebSocket {
        static OPEN = 1;
        constructor() {
            socket = this;
            this.readyState = TestWebSocket.OPEN;
        }
        close() {}
        send() {}
    }

    const viewer = {
        entities: {
            add(entity) {
                // This mimics Cesium's 2D geometry worker: an Earth-centre
                // sample has no Cartographic longitude and must be rejected
                // before a polyline reaches the renderer.
                const positions = entity?.polyline?.positions;
                if (Array.isArray(positions) && positions.some((position) => (
                    Math.hypot(position.x, position.y, position.z) < 1_000
                ))) {
                    throw new TypeError("Cannot read properties of undefined (reading 'longitude')");
                }
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
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                reference_frame: "ITRF",
                points: [
                    { time: "2026-08-10T12:00:00.000Z", position: { x: 7_000_000, y: 0, z: 0 } },
                    // This is the real-world missing-state spelling found in
                    // the supplied CODE MGEX SP3 for C08.
                    { time: "2026-08-10T12:01:00.000Z", position: { x: 0, y: 0, z: 0 } },
                    { time: "2026-08-10T12:02:00.000Z", position: { x: 7_200_000, y: 120_000, z: 0 } }
                ]
            })
        });

        setOrbitConfig({
            satellite_use_3d_model: false,
            orbit_future_show: true,
            orbit_ground_track_show: false,
            propagation_hours: 1
        });
        setSimulationTimelineProvider(() => ({
            mode: "range",
            date: new Date("2026-08-10T12:01:00.000Z"),
            rangeStart: new Date("2026-08-10T12:00:00.000Z"),
            rangeEnd: new Date("2026-08-10T12:02:00.000Z")
        }));
        registerPreciseProductSatelliteEntries([{
            id: stationId,
            name: "BeiDou C08",
            sourceFormat: "SP3",
            satellite_id: "C08",
            product_id: "missing-state",
            sp3: {
                reference_frame: "ITRF",
                time_scale: "GPS",
                start_time: "2026-08-10T12:00:00.000Z",
                end_time: "2026-08-10T12:02:00.000Z"
            }
        }]);
        initSatelliteReceiver(viewer);
        assert.equal(setSatelliteLayerActive(stationId, true), true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        const orbit = entities.find((entity) => entity.id === `${stationId}-orbit`);
        assert.ok(orbit, "the valid surrounding samples still render an orbit");
        assert.equal(orbit.polyline.positions.length, 2);
        assert.ok(orbit.polyline.positions.every((position) => (
            Math.hypot(position.x, position.y, position.z) >= 1_000
        )));
        assert.doesNotThrow(() => refreshSatelliteOverlays(viewer));

        // Older persisted runtimes can also send a rolling orbit without
        // passing through /api/ephemeris. Keep the same final renderer guard
        // for that compatibility path.
        setSimulationTimelineProvider(null);
        await socket.onmessage({
            data: JSON.stringify({
                type: "orbits",
                data: [{
                    satellite: stationId,
                    orbit: [
                        { x: 7_000_000, y: 0, z: 0 },
                        { x: 0, y: 0, z: 0 },
                        { x: 7_200_000, y: 120_000, z: 0 }
                    ]
                }]
            })
        });
        assert.equal(orbit.polyline.positions.length, 2);
        assert.ok(orbit.polyline.positions.every((position) => (
            Math.hypot(position.x, position.y, position.z) >= 1_000
        )));
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

test("SP3 entries without valid member coverage fail closed and never request ephemerides", async () => {
    const previous = {
        Cesium: globalThis.Cesium,
        window: globalThis.window,
        WebSocket: globalThis.WebSocket,
        fetch: globalThis.fetch,
        requestAnimationFrame: globalThis.requestAnimationFrame
    };
    const missingId = "precise:coverage-missing:G11";
    const malformedId = "precise:coverage-malformed:G12";
    let ephemerisRequests = 0;

    class TestWebSocket {
        static OPEN = 1;
        constructor() {
            this.readyState = TestWebSocket.OPEN;
        }
        close() {}
        send() {}
    }

    const viewer = {
        entities: {
            add(entity) { return entity; },
            remove() { return true; }
        }
    };

    try {
        globalThis.Cesium = createCesiumTestDouble();
        globalThis.window = { location: { protocol: "http:", host: "orbit.test" } };
        globalThis.WebSocket = TestWebSocket;
        globalThis.requestAnimationFrame = () => 0;
        globalThis.fetch = async () => {
            ephemerisRequests += 1;
            return { ok: true, json: async () => ({ points: [] }) };
        };
        setOrbitConfig({
            satellite_use_3d_model: false,
            orbit_future_show: false,
            orbit_ground_track_show: false,
            propagation_hours: 1
        });
        setSimulationTimelineProvider(() => ({
            mode: "range",
            date: new Date("2026-08-10T12:00:30.000Z"),
            rangeStart: new Date("2026-08-10T12:00:00.000Z"),
            rangeEnd: new Date("2026-08-10T12:01:00.000Z")
        }));
        registerPreciseProductSatelliteEntries([
            {
                id: missingId,
                name: "GPS 11",
                sourceFormat: "SP3",
                satellite_id: "G11",
                product_id: "coverage-missing",
                sp3: { reference_frame: "ITRF", time_scale: "GPS" }
            },
            {
                id: malformedId,
                name: "GPS 12",
                sourceFormat: "SP3",
                satellite_id: "G12",
                product_id: "coverage-malformed",
                sp3: {
                    reference_frame: "ITRF",
                    time_scale: "GPS",
                    start_time: "not-a-utc-date",
                    end_time: "2026-08-10T12:01:00.000Z"
                }
            }
        ]);
        initSatelliteReceiver(viewer);

        assert.equal(setSatelliteLayerActive(missingId, true), true);
        assert.equal(setSatelliteLayerActive(malformedId, true), true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        refreshSatelliteOverlays(viewer);

        assert.equal(ephemerisRequests, 0);
        for (const id of [missingId, malformedId]) {
            const status = getObjectMtrStatus(id, "2026-08-10T12:00:30.000Z");
            assert.equal(status.status, "out_of_range");
            assert.equal(status.active, false);
            assert.equal(status.hasIntrinsicTimeRange, false);
            assert.equal(status.reason, "intrinsic-time-range-unavailable");

            const telemetry = getSatelliteTelemetry(id);
            assert.equal(telemetry.runtime_state, "OUT_OF_RANGE");
            assert.equal(telemetry.position, null);
            assert.equal(telemetry.out_of_range_reason, "intrinsic-time-range-unavailable");
        }

        // A normal catalogue source has no finite coverage contract and must
        // remain usable instead of inheriting the SP3 fail-closed policy.
        const tleStatus = getObjectMtrStatus("catalogue-tle-control", "2026-08-10T12:00:30.000Z");
        assert.equal(tleStatus.status, "active");
        assert.equal(tleStatus.active, true);
        assert.equal(tleStatus.reason, null);
    } finally {
        setSatelliteLayerActive(missingId, false);
        setSatelliteLayerActive(malformedId, false);
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

test("an SP3 that becomes out of range removes every stale orbit, ground-track and footprint entity", async () => {
    const previous = {
        Cesium: globalThis.Cesium,
        window: globalThis.window,
        WebSocket: globalThis.WebSocket,
        fetch: globalThis.fetch,
        requestAnimationFrame: globalThis.requestAnimationFrame
    };
    const satelliteId = "precise:out-of-range-rendering:G01";
    const entities = [];
    let timeline = {
        mode: "range",
        date: new Date("2026-08-10T12:01:00.000Z"),
        rangeStart: new Date("2026-08-10T12:00:00.000Z"),
        rangeEnd: new Date("2026-08-10T12:02:00.000Z")
    };

    class TestWebSocket {
        static OPEN = 1;

        constructor() {
            this.readyState = 0;
        }

        close() {}
        send() {}
    }

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
    const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
    const hasOverlay = (suffix) => entities.some((entity) => entity.id === `${satelliteId}${suffix}`);

    try {
        globalThis.Cesium = createCesiumTestDouble();
        // The shared compact double maps every Cartesian sample to one point.
        // This case needs a genuine projected path so ground-track creation is
        // a meaningful precondition for the out-of-range cleanup assertion.
        globalThis.Cesium.Cartographic.fromCartesian = (cartesian) => {
            const horizontal = Math.hypot(cartesian.x, cartesian.y);
            return {
                longitude: Math.atan2(cartesian.y, cartesian.x),
                latitude: Math.atan2(cartesian.z, horizontal),
                height: Math.hypot(horizontal, cartesian.z) - 6_378_137
            };
        };
        globalThis.window = { location: { protocol: "http:", host: "orbit.test" } };
        globalThis.WebSocket = TestWebSocket;
        globalThis.requestAnimationFrame = () => 0;
        globalThis.fetch = async () => ({
            ok: true,
            json: async () => ({
                reference_frame: "ITRF",
                points: [
                    { time: "2026-08-10T12:00:00.000Z", position: { x: 7_000_000, y: 0, z: 0 } },
                    { time: "2026-08-10T12:01:00.000Z", position: { x: 7_050_000, y: 30_000, z: 0 } },
                    { time: "2026-08-10T12:02:00.000Z", position: { x: 7_100_000, y: 60_000, z: 0 } }
                ]
            })
        });

        setOrbitConfig({
            satellite_use_3d_model: false,
            orbit_future_show: true,
            orbit_ground_track_show: true,
            propagation_hours: 1
        });
        setSimulationTimelineProvider(() => timeline);
        registerPreciseProductSatelliteEntries([{
            id: satelliteId,
            name: "GPS 01",
            sourceFormat: "SP3",
            satellite_id: "G01",
            product_id: "out-of-range-rendering",
            sp3: {
                reference_frame: "ITRF",
                time_scale: "GPS",
                start_time: "2026-08-10T12:00:00.000Z",
                end_time: "2026-08-10T12:02:00.000Z"
            }
        }]);
        initSatelliteReceiver(viewer);
        assert.equal(setSatelliteLayerActive(satelliteId, true), true);
        await nextTask();
        await nextTask();
        refreshSatelliteOverlays(viewer);

        assert.equal(hasOverlay("-orbit"), true, "precondition: an in-range SP3 creates its spatial orbit");
        assert.equal(hasOverlay("-ground-track"), true, "precondition: an in-range SP3 creates its ground track");
        assert.equal(hasOverlay("-footprint"), true, "precondition: an in-range SP3 creates its visibility footprint");

        // Move the shared range after the published SP3 coverage.  The
        // selected layer is still active, so a stale Cesium primitive would
        // be visible unless the temporal transition removes it explicitly.
        timeline = {
            mode: "range",
            date: new Date("2026-08-10T13:01:00.000Z"),
            rangeStart: new Date("2026-08-10T13:00:00.000Z"),
            rangeEnd: new Date("2026-08-10T14:00:00.000Z")
        };
        refreshSatelliteOverlays(viewer);

        const telemetry = getSatelliteTelemetry(satelliteId);
        assert.equal(telemetry.runtime_state, "OUT_OF_RANGE");
        assert.equal(telemetry.position, null);
        assert.equal(telemetry.is_visible, false);
        assert.equal(hasOverlay("-orbit"), false, "no stale spatial orbit may survive outside SP3 coverage");
        assert.equal(hasOverlay("-ground-track"), false, "no stale ground track may survive outside SP3 coverage");
        assert.equal(hasOverlay("-footprint"), false, "no stale visibility footprint may survive outside SP3 coverage");

        const pooledSatelliteEntity = entities.find((entity) => entity.satelliteId === satelliteId);
        assert.ok(pooledSatelliteEntity, "the pooled marker remains owned by the layer");
        assert.equal(pooledSatelliteEntity.show, false, "the satellite marker itself is hidden outside coverage");
    } finally {
        setSatelliteLayerActive(satelliteId, false);
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

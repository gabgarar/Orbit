import assert from "node:assert/strict";
import test from "node:test";

import { createGroundStationTelemetryService } from "../../js/features/groundStations/telemetry.js";

const STATION = {
    id: "station-madrid",
    name: "Madrid",
    latitude_deg: 40.4168,
    longitude_deg: -3.7038,
    altitude_m: 650,
    min_elevation_deg: 10
};

const DATES = {
    startDate: new Date("2026-08-08T00:00:00Z"),
    endDate: new Date("2026-08-09T00:00:00Z")
};

function createService({ satelliteIds, getPasses }) {
    return createGroundStationTelemetryService({
        getPasses,
        getSatelliteStates: () => satelliteIds.map((id) => ({ id })),
        getLayerName: (id) => id,
        calculateElevationDegrees: () => null,
        calculatePlanningLink: () => null,
        calculateSatelliteDownlink: () => null,
        calculateRfModel: () => ({})
    });
}

test("next-pass refresh includes every satellite while limiting requests to two at a time", async () => {
    const satelliteIds = ["sat-1", "sat-2", "sat-3", "sat-4", "sat-5"];
    let activeRequests = 0;
    let peakRequests = 0;
    const requestedIds = [];
    const service = createService({
        satelliteIds,
        getPasses: async (satelliteId) => {
            requestedIds.push(satelliteId);
            activeRequests += 1;
            peakRequests = Math.max(peakRequests, activeRequests);
            await new Promise((resolve) => setTimeout(resolve, 5));
            activeRequests -= 1;
            return [{
                aos: `${satelliteId}-aos`,
                los: `${satelliteId}-los`,
                max_elevation_deg: 42
            }];
        }
    });

    await service.refreshPasses(STATION, DATES.startDate, DATES.endDate);
    const telemetry = service.build(STATION, DATES);

    assert.deepEqual(requestedIds.sort(), satelliteIds);
    assert.equal(peakRequests, 2);
    assert.deepEqual(telemetry.next_passes.map((row) => row.satellite), satelliteIds);
});

test("next-pass refresh keeps successful rows when one satellite query fails", async () => {
    const satelliteIds = ["sat-a", "sat-b", "sat-c"];
    let revision = 0;
    const service = createService({
        satelliteIds,
        getPasses: async (satelliteId) => {
            if (revision === 1 && satelliteId === "sat-b") throw new Error("propagator unavailable");
            if (satelliteId === "sat-c") return [];
            return [{
                aos: `${satelliteId}-aos-${revision}`,
                los: `${satelliteId}-los-${revision}`,
                max_elevation_deg: revision ? 55 : 40
            }];
        }
    });

    await service.refreshPasses(STATION, DATES.startDate, DATES.endDate);
    revision = 1;
    await service.refreshPasses(STATION, DATES.startDate, DATES.endDate);
    const telemetry = service.build(STATION, DATES);
    const bySatellite = Object.fromEntries(telemetry.next_passes.map((row) => [row.satellite, row]));

    assert.deepEqual(Object.keys(bySatellite), ["sat-a", "sat-b"]);
    assert.equal(bySatellite["sat-a"].aos, "sat-a-aos-1");
    assert.equal(bySatellite["sat-b"].aos, "sat-b-aos-0");
    assert.equal(bySatellite["sat-a"].max_elevation_deg, 55);
    assert.equal(bySatellite["sat-b"].max_elevation_deg, 40);
});

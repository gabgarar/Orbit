import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.route("**/*", (route) => {
        const request = route.request();
        if (request.url().includes("api.cesium.com") || ["image", "media", "font"].includes(request.resourceType())) {
            return route.abort();
        }
        return route.continue();
    });
});

test.afterEach(async ({ page }) => {
    await page.goto("about:blank", { waitUntil: "commit", timeout: 5_000 }).catch(() => {});
});

async function openWorkspace(page) {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => window.__orbitRuntimeStatus?.state || "loading"), { timeout: 15_000 }).toBe("ready");
    await welcome.getByRole("button", { name: "New project", exact: true }).click();
    const dialog = page.locator("#projectActionModal");
    await dialog.getByLabel("Nombre del proyecto").fill("Object detail tabs");
    await dialog.getByRole("button", { name: "Crear proyecto", exact: true }).click();
    await expect(dialog).toBeHidden();
}

test("the selected-orbit card has separate Overview, Orbit, Telemetry, Input and Propagation tabs", async ({ page }) => {
    await openWorkspace(page);
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("orbit:selected-object", {
            detail: {
                id: "OBJECT-DETAILS-1",
                selectionRevision: 1,
                sourceFormat: "TLE",
                active: true,
                visible: true,
                noradId: "25544",
                catalogMeta: { name: "ISS (ZARYA)", tleSource: "Celestrak", objectId: "1998-067A" },
                tleSummary: {
                    line1: "1 25544U 98067A   26197.25000000  .00000000  00000-0  00000-0 0  9991",
                    line2: "2 25544  51.6400  10.0000 0005000  20.0000 340.0000 15.50000000123456",
                    epoch: "26197.25000000",
                    meanMotionRevDay: "15.50000000",
                    bstar: "00000-0",
                    inclinationDeg: "51.6400",
                    raanDeg: "10.0000",
                    eccentricity: "0.0005000",
                    argPerigeeDeg: "20.0000",
                    meanAnomalyDeg: "340.0000"
                },
                telemetry: {
                    id: "OBJECT-DETAILS-1",
                    source_format: "TLE",
                    position_frame: "ITRF",
                    velocity_frame: "ITRF",
                    geo: { latitude_deg: 10.5, longitude_deg: -4.2, altitude_m: 420000 },
                    position: { x: 6500000, y: 1200000, z: 1800000 },
                    velocity: { x: -1400, y: 7200, z: 2100 },
                    speed_m_s: 7601.2,
                    runtime_state: "ACTIVE",
                    simulation: { mode: "simulated", time_scale: 10 }
                }
            }
        }));
    });

    const panel = page.locator(".object-details-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab")).toHaveCount(5);
    await expect(panel.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Orbit", exact: true })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Telemetry", exact: true })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Ephemeris / Input", exact: true })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Propagation", exact: true })).toBeVisible();
    await expect(panel.getByText("Época de entrada", { exact: true })).toBeVisible();

    await panel.getByRole("tab", { name: "Ephemeris / Input", exact: true }).click();
    await expect(panel.getByText("Línea TLE 1", { exact: true })).toBeVisible();
    await expect(panel.getByText("BSTAR", { exact: true })).toBeVisible();

    await panel.getByRole("tab", { name: "Propagation", exact: true }).click();
    await expect(panel.getByText("Modelo de fuerzas", { exact: true })).toBeVisible();
    await expect(panel.getByText("Modelo NORAD fijo (SGP4)", { exact: true })).toBeVisible();

    await panel.getByRole("tab", { name: "Orbit", exact: true }).click();
    await expect(panel.getByText("Posición ITRF", { exact: true })).toBeVisible();
    await expect(panel.getByText("Velocidad ITRF", { exact: true })).toBeVisible();
});

test("the ground-station pattern tab distinguishes directivity from an available downlink SNR map", async ({ page }) => {
    await openWorkspace(page);
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("orbit:selected-object", {
            detail: {
                id: "GROUND-RF-1",
                selectionRevision: 1,
                name: "RF test station",
                layerType: "GROUND_STATION",
                active: true,
                visible: true,
                telemetry: {
                    station: {
                        id: "GROUND-RF-1",
                        name: "RF test station",
                        latitude_deg: 40.4168,
                        longitude_deg: -3.7038,
                        altitude_m: 667,
                        min_elevation_deg: 10,
                        antenna_diameter_m: 1.2,
                        antenna_efficiency: 0.6,
                        frequency_mhz: 2200,
                        polarization: "RHCP",
                        tx_power_dbm: 38,
                        system_temperature_k: 500,
                        receiver_bandwidth_hz: 25000,
                        operation_mode: "tracking"
                    }
                }
            }
        }));
    });

    const panel = page.locator(".object-details-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: "Antenna radiation pattern", exact: true }).click();
    await expect(panel.getByText("Mapa angular de ganancia", { exact: true })).toBeVisible();
    await expect(panel.getByText(/El mapa de SNR se habilita/)).toBeVisible();

    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
            detail: {
                analysisSelection: { stationId: "GROUND-RF-1", satelliteLayerId: "sat:RF-SAT" },
                satelliteName: "RF-SAT",
                rangeKm: 1000,
                satelliteRfProfile: {
                    eirp_dbm: 42,
                    frequency_mhz: 2200,
                    polarization: "RHCP",
                    bandwidth_hz: 20000
                }
            }
        }));
    });

    await expect(panel.getByText("Mapa angular de margen SNR", { exact: true })).toBeVisible();
    await expect(panel.getByText(/Muestra angular del enlace de bajada hacia RF-SAT/)).toBeVisible();
});

test("a ground-station context menu opens the shared station export format picker", async ({ page }) => {
    await openWorkspace(page);
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("orbit:layer-context-menu", {
            detail: {
                id: "ground-station:madrid",
                name: "Est. Madrid",
                left: 40,
                top: 40,
                layerType: "GROUND_STATION",
                groundStation: true,
                visible: true
            }
        }));
        const events = [];
        const listener = (event) => {
            events.push(event.detail);
            event.stopImmediatePropagation();
        };
        window.__orbitGroundStationExportProbe = { events, listener };
        window.addEventListener("orbit:ground-stations-export-request", listener, true);
    });

    try {
        const menu = page.locator("#catalogContextMenu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitem", { name: /Exportar/ })).toBeVisible();
        await menu.getByRole("menuitem", { name: /Exportar/ }).click();
        await expect(menu).toBeHidden();
        const formats = page.locator("#groundStationExportMenu");
        await expect(formats).toBeVisible();
        await formats.getByRole("menuitem", { name: "GeoJSON" }).click();
        expect(await page.evaluate(() => window.__orbitGroundStationExportProbe.events)).toEqual([{
            stationId: "ground-station:madrid",
            format: "geojson",
            source: "layer-context"
        }]);
    } finally {
        await page.evaluate(() => {
            const probe = window.__orbitGroundStationExportProbe;
            if (probe) window.removeEventListener("orbit:ground-stations-export-request", probe.listener, true);
            delete window.__orbitGroundStationExportProbe;
        });
    }
});

import { expect, test } from "@playwright/test";
import { openWorkspaceThroughLocalIdentity } from "./helpers/identity-workspace.js";

test.beforeEach(async ({ page }) => {
    // The panel contract is independent of imagery and other visual assets.
    // Avoid loading them so this focused browser test stays deterministic.
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
    await openWorkspaceThroughLocalIdentity(page, "Propagated parameters frames");
    await expect(page.locator("#topToolbar")).toBeVisible();
}

test("el inspector distingue el marco dinámico del marco de visualización de un diseño manual", async ({ page }) => {
    await openWorkspace(page);

    // Exercise the panel's public state-event boundary. The propagation
    // result is intentionally EME2000, while the Manual Orbit preview the
    // user selected is ITRF. Both identities must survive presentation.
    await page.evaluate(() => {
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent("orbit:propagated-parameters-state", {
                detail: {
                    open: true,
                    status: "ready",
                    target: {
                        id: "manual-design",
                        name: "Manual Orbit",
                        source: "manual",
                        propagator: "two-body",
                        displayReferenceFrame: "ITRF"
                    },
                    range: {
                        mode: "manual-design",
                        startTime: "2026-08-06T12:32:00.000Z",
                        endTime: "2026-08-13T14:31:00.000Z",
                        displayReferenceFrame: "ITRF"
                    },
                    result: {
                        source: "manual",
                        propagator: "two-body",
                        reference_frame: "EME2000",
                        samples: [{
                            time: "2026-08-06T12:32:00.000Z",
                            semi_major_axis_km: 7000,
                            eccentricity: 0.01,
                            inclination_deg: 51.6
                        }, {
                            time: "2026-08-06T12:47:00.000Z",
                            semi_major_axis_km: 7000.2,
                            eccentricity: 0.0101,
                            inclination_deg: 51.61
                        }]
                    }
                }
            }));
            resolve();
        })));
    });

    const panel = page.locator(".propagated-orbit-parameters-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", {
        name: "Parámetros orbitales propagados de Manual Orbit"
    })).toBeVisible();

    const metadata = panel.locator('[aria-label="Metadatos del modelo"]');
    await expect(metadata.getByText("DYNAMICS FRAME", { exact: true })).toBeVisible();
    await expect(metadata.getByText("EME2000", { exact: true })).toBeVisible();
    await expect(metadata.getByText("DISPLAY FRAME", { exact: true })).toBeVisible();
    await expect(metadata.getByText("ITRF", { exact: true })).toBeVisible();

    await panel.getByRole("tab", { name: "Gráfica", exact: true }).click();
    await expect(panel.locator('[title="Reference frame used to derive the plotted osculating elements"]')).toContainText("EME2000");
    await expect(panel.locator("svg text").filter({ hasText: "Semimajor axis (km)" })).toBeVisible();

    const chartPicker = panel.getByTitle("Choose chart parameter");
    await chartPicker.click();
    const unselectedChartOption = panel.getByRole("menuitemradio", { name: "Eccentricity", exact: true });
    await expect(unselectedChartOption).toHaveCSS("background-color", "rgb(11, 24, 42)");
    await chartPicker.click();

    await panel.getByRole("tab", { name: "Valores", exact: true }).click();
    const valueTable = panel.locator('[aria-label="Tabla de valores propagados calculados en EME2000"]');
    await expect(valueTable).toBeVisible();
    await expect(valueTable).toHaveClass(/orbit-scrollbar/);
});

test("a saved manual layer keeps ITRF as the inspector display frame", async ({ page }) => {
    await openWorkspace(page);

    // Create and commit a real Manual Orbit through the public workspace
    // flow. This is deliberately different from the design-session contract
    // above: after confirmation the inspector must recover the display frame
    // from the saved local layer, rather than falling back to catalogue TEME.
    const manualOrbitButton = page.locator("#leftManualOrbitBtn");
    await manualOrbitButton.click();
    const confirmation = page.locator("#sidebarConfirmModal");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("Layers");
    await expect(confirmation).toContainText(/segundo plano/i);

    // Cancelling the scene transition must leave Layers exactly where it was.
    await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.locator("#leftSatellitesPanel")).toHaveClass(/open/);
    await expect(page.locator("#manualOrbitPanel")).toBeHidden();

    await manualOrbitButton.click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Continuar", exact: true }).click();
    const designer = page.locator("#manualOrbitPanel");
    await expect(designer).toBeVisible();
    await designer.getByRole("tab", { name: "PROPAGATION", exact: true }).click();

    const itrf = designer.getByRole("radio", { name: /ITRF/ });
    await itrf.click();
    await expect(itrf).toHaveAttribute("aria-checked", "true");

    await designer.locator("footer button").last().click();
    await expect(designer).toBeHidden({ timeout: 30_000 });
    await expect.poll(
        () => page.evaluate(() => window.__orbitManualOrbitState?.previewReferenceFrame || null),
        { timeout: 5_000 }
    ).toBe("itrf");

    const propagatedParametersButton = page.locator("#leftPropagatedParametersBtn");
    await expect(propagatedParametersButton).toBeEnabled({ timeout: 15_000 });
    await propagatedParametersButton.click();

    const panel = page.locator(".propagated-orbit-parameters-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const metadata = panel.locator('[aria-label="Metadatos del modelo"]');
    await expect(metadata.getByText("DISPLAY FRAME", { exact: true })).toBeVisible();
    await expect(metadata.getByText("ITRF", { exact: true })).toBeVisible();
    await expect(metadata.getByText("TEME", { exact: true })).toHaveCount(0);
});

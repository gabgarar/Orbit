import { expect, test } from "@playwright/test";

const viewports = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "laptop", width: 1366, height: 768 },
    { name: "small-laptop", width: 1280, height: 720 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 }
];

const zoomLevels = [1, 0.9, 0.8, 0.75];
const catalogControlSelectors = [
    "[data-testid='catalog-import']",
    "[data-testid='catalog-filters']",
    "[data-testid='catalog-refresh']",
    "[data-testid='catalog-select-all']",
    "#catalogModal button[aria-label='Cerrar']"
];
let workspaceSequence = 0;

test.beforeEach(async ({ page }) => {
    // UI checks do not need the globe textures, stars, or Cesium icon images.
    // Blocking those assets makes each isolated browser context fast and
    // prevents WebGL teardown from dominating the test duration.
    await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        const requestUrl = route.request().url();
        // The external terrain service is not part of this UI contract. The
        // runtime handles this failure by falling back to local ellipsoid
        // terrain, which keeps the suite deterministic when offline.
        if (requestUrl.includes("api.cesium.com") || ["image", "media", "font"].includes(resourceType)) {
            return route.abort();
        }
        return route.continue();
    });
});

test.afterEach(async ({ page }) => {
    // Explicitly unload Cesium before Playwright destroys the browser context.
    await page.goto("about:blank", { waitUntil: "commit", timeout: 5_000 }).catch(() => {});
});

async function openCatalog(page, viewport, zoom = 1) {
    await page.setViewportSize(viewport);
    await openWorkspace(page);

    // CSS zoom gives the test suite a deterministic approximation of browser
    // zoom. The layout must remain valid at each supported visual density.
    if (zoom !== 1) {
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` });
    }

    await expect(page.locator("#topToolbar")).toBeVisible({ timeout: 15_000 });
    await ensureLayersPanelOpen(page);
    await expectApplicationShellLayout(page);
    await chooseLayerKind(page, "satellite");
    await expect(page.locator("#catalogModal")).toBeVisible();
}

/**
 * Each Playwright test receives a clean browser context, so Orbit correctly
 * starts on its welcome screen. Enter the workspace through the user flow
 * before interacting with controls behind that modal.
 */
async function openWorkspace(page) {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await waitForOrbitRuntimeReady(page);
    await welcome.getByRole("button", { name: "New project", exact: true }).click();

    const actionModal = page.locator("#projectActionModal");
    await expect(actionModal).toBeVisible();
    await actionModal.getByLabel("Nombre del proyecto").fill(`Responsive workspace ${++workspaceSequence}`);
    await actionModal.getByRole("button", { name: "Crear proyecto", exact: true }).click();
    await expect(welcome).toBeHidden();
    await expect(actionModal).toBeHidden();
}

async function waitForOrbitRuntimeReady(page) {
    await expect.poll(
        () => page.evaluate(() => window.__orbitRuntimeStatus?.state || "loading"),
        { timeout: 15_000, message: "Orbit runtime must become ready before a project is created" }
    ).toBe("ready");
}

function applicationOrigin(testInfo) {
    const baseUrl = testInfo.project.use.baseURL || "http://127.0.0.1:8100";
    return new URL(baseUrl).origin;
}

async function ensureLayersPanelOpen(page) {
    const panel = page.locator("#leftSatellitesPanel");
    const isOpen = await panel.evaluate((element) => element.classList.contains("open"));
    if (!isOpen) {
        await page.locator("#leftSatellitesBtn").click();
    }
    await expect(panel).toHaveClass(/open/);
    await expect.poll(
        () => panel.evaluate((element) => Math.round(element.getBoundingClientRect().left)),
        { timeout: 5_000, message: "Layer panel must finish opening inside the viewport" }
    ).toBeGreaterThanOrEqual(-1);
}

/**
 * The React shell renders its add button before the legacy layer bridge
 * finishes attaching its event listener. Wait for that bridge to expose its
 * real menu instead of clicking the hidden compatibility buttons directly.
 */
async function openLayerAddMenu(page) {
    const addButton = page.locator("#leftSatellitesPanel #openCatalogBtn");
    const addMenu = page.locator("#layerAddMenu");
    await expect(addButton).toBeVisible({ timeout: 15_000 });
    await expect.poll(
        () => page.evaluate(() => {
            const control = document.querySelector("#leftSatellitesPanel #openCatalogBtn");
            const menu = document.querySelector("#layerAddMenu");
            if (!(control instanceof HTMLButtonElement) || control.disabled || !control.isConnected || !(menu instanceof HTMLElement)) {
                return false;
            }
            if (!menu.classList.contains("open")) {
                control.click();
            }
            return menu.classList.contains("open");
        }),
        { timeout: 15_000, message: "Layer add menu must become available" }
    ).toBe(true);
    await expect(addMenu).toHaveClass(/open/);
}

async function chooseLayerKind(page, kind) {
    await openLayerAddMenu(page);
    const addLayerMenu = page.locator("#layerAddMenu .folder-add-menu").filter({ hasText: "Add layer" });
    await addLayerMenu.hover();
    const layerKind = addLayerMenu.locator(`[data-add-kind="${kind}"]`);
    await expect(layerKind).toBeVisible();
    await layerKind.click();
}

async function expectApplicationShellLayout(page) {
    const shell = await page.evaluate(() => {
        const selectors = ["#topToolbar", "#leftSidebar", "#leftSatellitesPanel"];
        return selectors.map((selector) => {
            const element = document.querySelector(selector);
            const rect = element?.getBoundingClientRect();
            return rect && element
                ? {
                    selector,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                    scrollWidth: element.scrollWidth,
                    clientWidth: element.clientWidth,
                    overflowX: getComputedStyle(element).overflowX
                }
                : null;
        });
    });

    for (const item of shell) {
        expect(item, "Core application element must exist").not.toBeNull();
        expect(item.width, `${item.selector} must have usable width`).toBeGreaterThan(20);
        expect(item.height, `${item.selector} must have usable height`).toBeGreaterThan(20);
        expect(item.left, `${item.selector} must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
        expect(item.right, `${item.selector} must stay inside the viewport`).toBeLessThanOrEqual((await page.viewportSize()).width + 1);
        if (item.selector === "#leftSatellitesPanel") {
            // The centered collapse handle intentionally extends 13px beyond
            // the panel edge. It must not turn that visual affordance into a
            // horizontal scroll area.
            expect(item.overflowX, `${item.selector} must not scroll horizontally`).not.toMatch(/auto|scroll/);
        } else {
            expect(item.scrollWidth, `${item.selector} must not create horizontal overflow`).toBeLessThanOrEqual(item.clientWidth + 1);
        }
    }

    // A newly-created workspace has no layers, so its destructive bulk action
    // must not be exposed. The UI hides it through CSS rather than the HTML
    // `hidden` attribute, therefore validate rendered visibility directly.
    const removeAllButton = page.locator("#removeAllLayersHeaderBtn");
    await expect(removeAllButton).toBeHidden();

    const layerPanelControls = await page.evaluate(() => {
        const panel = document.querySelector("#leftSatellitesPanel");
        const resizeHandle = panel?.querySelector(".sidebar-panel-resize-handle");
        const addLayer = panel?.querySelector(".react-layer-tree .object-list-add-item");
        const panelRect = panel?.getBoundingClientRect();
        const resizeHandleRect = resizeHandle?.getBoundingClientRect();
        const addLayerRect = addLayer?.getBoundingClientRect();

        return panelRect && resizeHandleRect
            ? {
                panel: panelRect.toJSON(),
                resizeHandle: { ...resizeHandleRect.toJSON(), cursor: getComputedStyle(resizeHandle).cursor },
                addLayer: addLayerRect
                    ? {
                        ...addLayerRect.toJSON(),
                        fontSize: Number.parseFloat(getComputedStyle(addLayer).fontSize),
                        visible: getComputedStyle(addLayer).visibility !== "hidden" && addLayerRect.width > 0 && addLayerRect.height > 0
                    }
                    : null
            }
            : null;
    });

    expect(layerPanelControls, "Layer panel controls must exist").not.toBeNull();
    expect(layerPanelControls.resizeHandle.cursor, "Layer panel must expose a resize handle").toBe("col-resize");
    expect(layerPanelControls.resizeHandle.right, "Resize handle must reach the right panel edge").toBeGreaterThanOrEqual(layerPanelControls.panel.right - 1);
    expect(layerPanelControls.addLayer, "Visible React add-layer control must exist").not.toBeNull();
    expect(layerPanelControls.addLayer.visible, "Add-layer control must be visible").toBeTruthy();
    expect(layerPanelControls.addLayer.height, "Add-layer control must remain compact").toBeLessThanOrEqual(42);
    expect(layerPanelControls.addLayer.fontSize, "Layer names must match catalog density").toBeLessThanOrEqual(12);
}

async function expectCatalogLayout(page, zoom = 1) {
    const layout = await page.locator("#catalogModal > section").evaluate((panel, selectors) => {
        const panelRect = panel.getBoundingClientRect();
        const controls = selectors.map((selector) => {
            const element = document.querySelector(selector);
            const rect = element?.getBoundingClientRect();
            return rect && element
                ? {
                    selector,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height
                }
                : null;
        });

        return {
            panel: {
                left: panelRect.left,
                right: panelRect.right,
                top: panelRect.top,
                bottom: panelRect.bottom
            },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            controls
        };
    }, catalogControlSelectors);

    expect(layout.panel.left).toBeGreaterThanOrEqual(-1);
    expect(layout.panel.right).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(layout.panel.top).toBeGreaterThanOrEqual(-1);
    expect(layout.panel.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);

    for (const control of layout.controls) {
        expect(control, "Catalog control must exist").not.toBeNull();
        expect(control.width, `${control.selector} must have usable width`).toBeGreaterThan(24);
        // getBoundingClientRect() reports visual pixels, which are scaled by
        // the emulated browser zoom. Validate the same 24px target area after
        // accounting for that intentional scale.
        expect(control.height, `${control.selector} must have usable height`).toBeGreaterThan(24 * zoom - 1);
        expect(control.left, `${control.selector} must not be clipped on the left`).toBeGreaterThanOrEqual(layout.panel.left - 1);
        expect(control.right, `${control.selector} must not be clipped on the right`).toBeLessThanOrEqual(layout.panel.right + 1);
        expect(control.top, `${control.selector} must not be clipped above`).toBeGreaterThanOrEqual(layout.panel.top - 1);
        expect(control.bottom, `${control.selector} must not be clipped below`).toBeLessThanOrEqual(layout.panel.bottom + 1);
    }

    const closeButton = layout.controls.at(-1);
    expect(Math.abs(closeButton.width - closeButton.height), "Close button must remain circular").toBeLessThanOrEqual(2);
}

async function expectVisibleControlsInsideViewport(page, rootSelectors) {
    const audit = await page.evaluate((selectors) => selectors.map((selector) => {
        const root = document.querySelector(selector);
        const rootRect = root?.getBoundingClientRect();
        const controls = root
            ? [...root.querySelectorAll('button, input, select, textarea, [role="button"]')]
                .map((element) => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    const isVisible = !element.hidden
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && Number(style.opacity) > 0
                        && rect.width > 0
                        && rect.height > 0;
                    const intersectsViewport = rect.right > 0
                        && rect.bottom > 0
                        && rect.left < window.innerWidth
                        && rect.top < window.innerHeight;
                    return isVisible && intersectsViewport
                        ? {
                            label: element.getAttribute("aria-label") || element.id || element.textContent?.trim() || element.tagName,
                            left: rect.left,
                            right: rect.right,
                            top: rect.top,
                            bottom: rect.bottom,
                            width: rect.width,
                            height: rect.height
                        }
                        : null;
                })
                .filter(Boolean)
            : [];

        return {
            selector,
            root: rootRect ? rootRect.toJSON() : null,
            controls,
            viewport: { width: window.innerWidth, height: window.innerHeight }
        };
    }), rootSelectors);

    for (const root of audit) {
        expect(root.root, `${root.selector} must exist`).not.toBeNull();
        expect(root.controls.length, `${root.selector} must expose interactive controls`).toBeGreaterThan(0);
        for (const control of root.controls) {
            expect(control.width, `${control.label} must have usable width`).toBeGreaterThan(10);
            expect(control.height, `${control.label} must have usable height`).toBeGreaterThan(10);
            expect(control.left, `${control.label} must not be clipped on the left`).toBeGreaterThanOrEqual(-1);
            expect(control.right, `${control.label} must not be clipped on the right`).toBeLessThanOrEqual(root.viewport.width + 1);
            expect(control.top, `${control.label} must not be clipped above`).toBeGreaterThanOrEqual(-1);
            expect(control.bottom, `${control.label} must not be clipped below`).toBeLessThanOrEqual(root.viewport.height + 1);
        }
    }
}

async function expectPanelInsideViewport(page, selector) {
    const bounds = await page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
    });

    expect(bounds.left, `${selector} must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bounds.right, `${selector} must stay inside the viewport`).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.top, `${selector} must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom, `${selector} must stay inside the viewport`).toBeLessThanOrEqual(bounds.height + 1);
}

for (const viewport of viewports) {
    test(`Orbit se adapta a ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
        await openCatalog(page, viewport);
        await expectCatalogLayout(page);
    });
}

for (const zoom of zoomLevels) {
    test(`El catálogo conserva su composición a ${Math.round(zoom * 100)}% de zoom`, async ({ page }) => {
        await openCatalog(page, { width: 1366, height: 768 }, zoom);
        await expectCatalogLayout(page, zoom);
    });
}

test("Los paneles principales mantienen controles accesibles", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);

    await expect(page.locator("#topToolbar")).toBeVisible();
    await expect(page.locator("#leftSidebar")).toBeVisible();
    await expectVisibleControlsInsideViewport(page, ["#topToolbar", "#leftSidebar"]);

    const shellChrome = await page.evaluate(() => {
        const toolbar = document.querySelector("#topToolbar");
        const sidebar = document.querySelector("#leftSidebar");
        const firstIcon = sidebar?.querySelector(".sidebar-btn");
        const background = toolbar ? getComputedStyle(toolbar).backgroundColor : "";
        const alpha = background.match(/rgba?\\([^,]+,[^,]+,[^,]+(?:,\\s*([0-9.]+))?\\)/i)?.[1];
        return {
            toolbarBackground: background,
            toolbarAlpha: alpha === undefined ? 1 : Number(alpha),
            sidebarWidth: sidebar?.getBoundingClientRect().width || 0,
            iconSize: firstIcon?.getBoundingClientRect().width || 0
        };
    });

    expect(shellChrome.toolbarBackground, "Top toolbar must have an explicit background").not.toBe("");
    expect(shellChrome.toolbarAlpha, "Top toolbar must not reveal the scene behind it").toBeGreaterThanOrEqual(0.99);
    expect(shellChrome.sidebarWidth, "The left icon rail must remain comfortably wide").toBeGreaterThanOrEqual(46);
    expect(shellChrome.iconSize, "The left rail icons must have a usable target size").toBeGreaterThanOrEqual(38);

    const layersButton = page.locator("#leftSatellitesBtn");
    const layersPanel = page.locator("#leftSatellitesPanel");
    await layersButton.click();
    await expect(layersPanel).not.toHaveClass(/open/);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open: true } })));
    await expect(layersPanel).toHaveClass(/open/);
    await expect(layersButton).toHaveClass(/active/);

    await page.locator("#topSettingsBtn").click();
    await expect(page.locator("#configModal")).toHaveClass(/open/);
    await expectPanelInsideViewport(page, "#configPanel");
    await expectVisibleControlsInsideViewport(page, ["#configPanel"]);
    await page.locator("#configPanel").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.locator("#configModal")).toHaveCount(0);

    const simulationDock = page.locator(".react-simulation-dock");
    await expect(simulationDock).toBeVisible();
    await expectPanelInsideViewport(page, ".react-simulation-dock");
    await expectVisibleControlsInsideViewport(page, [".react-simulation-dock"]);
    await simulationDock.getByRole("button", { name: "Real time", exact: true }).click();
    await simulationDock.getByRole("menuitem", { name: "Simulated", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Linea temporal de simulacion" })).toBeVisible();
    await expectVisibleControlsInsideViewport(page, [".react-simulation-dock"]);

    const helpButton = page.getByRole("button", { name: "Panel de ayuda", exact: true });
    await helpButton.click();
    await expect(page.locator(".react-help-panel")).toBeVisible();
    await expectPanelInsideViewport(page, ".react-help-panel");
    await expectVisibleControlsInsideViewport(page, [".react-help-panel"]);
    await page.locator(".react-help-panel").getByRole("button", { name: "Cerrar ayuda", exact: true }).click();
    await expect(page.locator(".react-help-panel")).toHaveCount(0);

    // Telemetry was intentionally retired with the React workspace sidebar;
    // keep that boundary explicit rather than silently exercising hidden DOM.
    await expect(page.locator("#leftInfoBtn")).toHaveCount(0);
    await expect(page.locator("#leftInfoPanel")).toHaveCount(0);

});

test("El panel de capas se redimensiona y se pliega al alcanzar el mínimo", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);

    const panel = page.locator("#leftSatellitesPanel");
    const handle = page.locator("#leftSatellitesPanel .sidebar-panel-resize-handle");
    const initialBounds = await panel.boundingBox();
    const initialHandle = await handle.boundingBox();
    expect(initialBounds).not.toBeNull();
    expect(initialHandle).not.toBeNull();

    await page.mouse.move(initialHandle.x + initialHandle.width / 2, initialHandle.y + 80);
    await page.mouse.down();
    await page.mouse.move(initialHandle.x + 80, initialHandle.y + 80);
    await page.mouse.up();

    const expandedBounds = await panel.boundingBox();
    expect(expandedBounds.width, "Dragging right must widen the layer panel").toBeGreaterThan(initialBounds.width + 50);

    const resizedHandle = await handle.boundingBox();
    await page.mouse.move(resizedHandle.x + resizedHandle.width / 2, resizedHandle.y + 80);
    await page.mouse.down();
    await page.mouse.move(expandedBounds.x + 175, resizedHandle.y + 80);
    await page.mouse.up();

    // Collapsing may remove a transient panel while keeping its sidebar
    // trigger. Both implementations represent the same closed state.
    await expect(page.locator("#leftSatellitesBtn")).not.toHaveClass(/active/);
});

test("El editor de estaciones de tierra mantiene sus formularios accesibles", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);
    await chooseLayerKind(page, "station");

    await expect(page.locator("#groundStationModal")).toHaveCount(1);
    await expect(page.locator("#groundStationModal")).toHaveClass(/open/);
    const groundStationPanel = page.locator("#groundStationModal .ground-station-panel");
    await expectPanelInsideViewport(page, "#groundStationModal .ground-station-panel");
    await expectVisibleControlsInsideViewport(page, ["#groundStationModal .ground-station-panel"]);

    const hasHorizontalOverflow = async () => groundStationPanel.evaluate((panel) => panel.scrollWidth > panel.clientWidth + 1);
    expect(await hasHorizontalOverflow(), "Ground station form must not create horizontal scrolling").toBeFalsy();

    for (const [tab, fieldSelector] of [["Radio", 'input[type="number"]'], ["Visual", 'input[type="color"]'], ["Heat map", 'input[type="checkbox"]']]) {
        const tabButton = groundStationPanel.getByRole("button", { name: tab, exact: true });
        await tabButton.click();
        await expect(tabButton).toHaveClass(/active/);
        await expect(groundStationPanel.locator(fieldSelector).first()).toBeVisible();
        await expectVisibleControlsInsideViewport(page, ["#groundStationModal .ground-station-panel"]);
        expect(await hasHorizontalOverflow(), "Ground station form must not create horizontal scrolling").toBeFalsy();
    }

    const heatmapToggle = groundStationPanel.locator('input[type="checkbox"]');
    await expect(heatmapToggle).toBeVisible();
    const heatmapToggleSize = await heatmapToggle.evaluate((input) => {
        const rect = input.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    expect(heatmapToggleSize.width, "Heat map toggle must be easy to activate").toBeGreaterThanOrEqual(22);
    expect(heatmapToggleSize.height, "Heat map toggle must be easy to activate").toBeGreaterThanOrEqual(22);
});

test("La bienvenida crea un proyecto y entrega el control al visor", async ({ page }) => {
    const projectName = "UI regression project";
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await waitForOrbitRuntimeReady(page);
    await welcome.getByRole("button", { name: "New project", exact: true }).click();

    const actionModal = page.locator("#projectActionModal");
    await expect(actionModal).toBeVisible();
    await actionModal.getByLabel("Nombre del proyecto").fill(projectName);
    await actionModal.getByRole("button", { name: "Crear proyecto", exact: true }).click();

    await expect(welcome).toBeHidden();
    await expect(actionModal).toBeHidden();
    await expect(page.locator("[data-project-title]").first()).toHaveText(new RegExp(`^${projectName}$`, "i"));
});

test("La bienvenida queda centrada y Generate orbit abre el diseñador con sus vectores", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#projectWelcome")).toBeVisible({ timeout: 15_000 });
    await waitForOrbitRuntimeReady(page);

    const welcomeCenter = await page.locator("#projectWelcome > div").last().evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2), width: window.innerWidth, height: window.innerHeight };
    });
    expect(Math.abs(welcomeCenter.x - (welcomeCenter.width / 2)), "Welcome dialog must be horizontally centred").toBeLessThanOrEqual(2);
    expect(Math.abs(welcomeCenter.y - (welcomeCenter.height / 2)), "Welcome dialog must be vertically centred").toBeLessThanOrEqual(2);

    await openWorkspace(page);
    await ensureLayersPanelOpen(page);
    await openLayerAddMenu(page);
    const addMenu = page.locator("#layerAddMenu");
    await addMenu.getByRole("button", { name: /Add layer/ }).hover();
    await addMenu.getByRole("button", { name: /Add satellite/ }).hover();
    const generateOrbit = page.locator("#generateOrbitBtn");
    await expect(generateOrbit).toBeVisible();
    // The legacy add-menu can be rebuilt while pointer hover moves through
    // its nested flyouts. Invoke the visible current control in page context
    // so this test verifies the command rather than a stale locator handle.
    await page.evaluate(() => document.querySelector("#generateOrbitBtn")?.click());

    const designer = page.locator("#manualOrbitPanel");
    await expect(designer).toBeVisible();
    const vectors = designer.getByRole("button", { name: "Ver ejes y vectores", exact: true });
    await expect(vectors).toBeVisible();
    await page.evaluate(() => Array.from(document.querySelectorAll("#manualOrbitPanel button"))
        .find((button) => button.textContent?.trim() === "Ver ejes y vectores")?.click());
    await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll("#manualOrbitPanel button"))
        .some((button) => button.textContent?.trim() === "Ocultar ejes y vectores"))).toBe(true);
    await expect(page.locator("#leftPropagatedParametersBtn")).toBeEnabled();
});

test("El visor no carga Cesium ni pako desde proveedores externos", async ({ page }, testInfo) => {
    const orbitOrigin = applicationOrigin(testInfo);
    const blockedExternalResources = [];
    const allowedTerrainRequests = [];
    const vendorResources = [];

    page.on("request", (request) => {
        let resourceUrl;
        try {
            resourceUrl = new URL(request.url());
        } catch {
            return;
        }

        if (["script", "stylesheet", "worker"].includes(request.resourceType())
            && /(?:cesium|pako)/i.test(`${resourceUrl.hostname}${resourceUrl.pathname}`)) {
            vendorResources.push({ url: resourceUrl.href, type: request.resourceType() });
        }
    });

    // The normal UI fixture aborts imagery and the optional Cesium terrain
    // request. This stricter route also stops any unexpected CDN request so a
    // successful result proves that startup is self-contained. Cesium terrain
    // remains an allowed, deliberately failed optional dependency because the
    // viewer falls back to local ellipsoid terrain.
    await page.route("**/*", (route) => {
        const request = route.request();
        let requestUrl;
        try {
            requestUrl = new URL(request.url());
        } catch {
            return route.continue();
        }

        if (requestUrl.origin !== orbitOrigin) {
            if (requestUrl.hostname === "api.cesium.com") {
                allowedTerrainRequests.push(requestUrl.href);
            } else {
                blockedExternalResources.push({ url: requestUrl.href, type: request.resourceType() });
            }
            return route.abort();
        }

        if (["image", "media", "font"].includes(request.resourceType())) {
            return route.abort();
        }
        return route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForOrbitRuntimeReady(page);

    expect(blockedExternalResources, `Orbit must not request external startup resources: ${JSON.stringify(blockedExternalResources)}`).toEqual([]);
    // A build may bundle a vendor module into a content-hashed application
    // asset, so do not require a particular filename. When Cesium/pako assets
    // are emitted separately, each one must still remain same-origin.
    for (const resource of vendorResources) {
        expect(new URL(resource.url).origin, `${resource.type} vendor resource must use Orbit origin`).toBe(orbitOrigin);
    }
    // Kept as a named value for failure diagnostics and to document that this
    // optional request is the only externally-addressable dependency allowed
    // by the startup contract.
    expect(allowedTerrainRequests.every((url) => new URL(url).hostname === "api.cesium.com")).toBeTruthy();

    // The live startup path covers the eagerly loaded pako bundle. Keep the
    // WebSocket fallback honest too: its source is served by Orbit and must
    // never retain a hidden CDN dynamic-import for browsers without
    // DecompressionStream.
    const websocketClientResponse = await page.request.get("/js/SatelliteWebSocket.js");
    expect(websocketClientResponse.ok(), "Orbit must serve the WebSocket client source").toBeTruthy();
    expect(await websocketClientResponse.text()).not.toMatch(/https?:\/\/[^"'`\s]*pako/i);
});

test("La telemetria WebSocket usa /ws del mismo origen y entrega el catalogo", async ({ page }) => {
    const websocketUrls = [];
    page.on("websocket", (socket) => websocketUrls.push(socket.url()));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForOrbitRuntimeReady(page);

    const expectedUrl = await page.evaluate(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/ws`;
    });

    // This is the WebSocket created by SatelliteWebSocket during normal UI
    // initialization, not only the diagnostic connection below.
    await expect.poll(
        () => websocketUrls.length,
        { timeout: 10_000, message: "Orbit UI must open its realtime WebSocket" }
    ).toBeGreaterThan(0);
    for (const url of websocketUrls) {
        expect(url, "Every UI WebSocket must use Orbit's same-origin /ws endpoint").toBe(expectedUrl);
    }

    const connectionState = await page.evaluate(() => new Promise((resolve) => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/ws`;
        const socket = new WebSocket(url);
        let settled = false;
        let timeout;
        const finish = (state) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            socket.close();
            resolve({ url, state });
        };
        timeout = window.setTimeout(() => finish("timeout"), 10_000);
        socket.addEventListener("message", (event) => {
            if (typeof event.data !== "string") {
                finish("non-text-catalog");
                return;
            }
            try {
                const payload = JSON.parse(event.data);
                finish(payload?.type === "catalog" && Array.isArray(payload.data) ? "catalog" : "unexpected-message");
            } catch {
                finish("invalid-json");
            }
        }, { once: true });
        socket.addEventListener("error", () => finish("error"), { once: true });
        socket.addEventListener("close", () => finish("closed"), { once: true });
    }));

    expect(connectionState.url).toBe(expectedUrl);
    expect(connectionState.state).toBe("catalog");
});

test("La bienvenida conserva comandos enviados antes de que el arbol de capas este listo", async ({ page }) => {
    let catalogRequestSeen = false;
    let releaseCatalog = () => {};

    await page.route(/\/api\/catalog\/page(?:\?.*)?$/, async (route) => {
        catalogRequestSeen = true;
        await new Promise((resolve) => {
            releaseCatalog = resolve;
        });
        await route.continue();
    });

    try {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto("/", { waitUntil: "domcontentloaded" });

        const welcome = page.locator("#projectWelcome");
        await expect(welcome).toBeVisible({ timeout: 15_000 });
        await expect.poll(
            () => catalogRequestSeen,
            { timeout: 15_000, message: "Catalog preload must be pending" }
        ).toBe(true);
        await expect.poll(
            () => page.evaluate(() => window.__orbitRuntimeStatus?.state || "loading"),
            { timeout: 5_000 }
        ).toBe("loading");

        await welcome.getByRole("button", { name: "New project", exact: true }).click();
        const actionModal = page.locator("#projectActionModal");
        await actionModal.getByLabel("Nombre del proyecto").fill("Queued workspace");
        await actionModal.getByRole("button", { name: "Crear proyecto", exact: true }).click();
        await expect(welcome).toBeVisible();

        releaseCatalog();
        await waitForOrbitRuntimeReady(page);
        await expect(welcome).toBeHidden({ timeout: 20_000 });
        await expect(page.locator("[data-project-title]").first()).toHaveText("QUEUED WORKSPACE");
    } finally {
        releaseCatalog();
    }
});

test("La bienvenida explica y bloquea acciones cuando el runtime no puede cargarse", async ({ page }) => {
    await page.route("**/legacyRuntime-*.js", (route) => route.abort());
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect(welcome.getByRole("alert")).toContainText("El visor no se pudo iniciar.");
    await expect(welcome.getByRole("button", { name: "New project", exact: true })).toBeDisabled();
    await expect(welcome.getByRole("button", { name: "Open project", exact: true })).toBeDisabled();
    await expect(page.locator("#projectActionModal")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__orbitPendingProjectCommands || [])).toEqual([]);
});

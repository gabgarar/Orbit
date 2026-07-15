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
    "#catalogImportBtn",
    "#catalogFiltersBtn",
    "#catalogRefreshBtn",
    "#catalogSelectAllBtn",
    "#catalogCloseBtn"
];

test.beforeEach(async ({ page }) => {
    // UI checks do not need the globe textures, stars, or Cesium icon images.
    // Blocking those assets makes each isolated browser context fast and
    // prevents WebGL teardown from dominating the test duration.
    await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (["image", "media", "font"].includes(resourceType)) {
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
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // CSS zoom gives the test suite a deterministic approximation of browser
    // zoom. The layout must remain valid at each supported visual density.
    if (zoom !== 1) {
        await page.addStyleTag({ content: `html { zoom: ${zoom}; }` });
    }

    await expect(page.locator("#topToolbar")).toBeVisible({ timeout: 15_000 });
    await page.locator("#leftSatellitesBtn").click();
    await expect(page.locator("#leftSatellitesPanel")).toBeVisible();
    await expectApplicationShellLayout(page);
    await clickLiveControl(page, "#leftSatellitesPanel #openCatalogBtn");
    await clickLiveControl(page, "#addSatelliteLayerBtn");
    await expect(page.locator("#catalogModal")).toHaveClass(/open/);
    await expect(page.locator("#catalogModal")).toBeVisible();
}

/**
 * Click controls that may be recreated while Cesium and catalog data finish
 * initialising, avoiding assertions against stale DOM references.
 */
async function clickLiveControl(page, selector) {
    await expect.poll(
        () => page.evaluate((targetSelector) => {
            const control = document.querySelector(targetSelector);
            if (!(control instanceof HTMLButtonElement) || control.disabled || !control.isConnected) {
                return false;
            }
            control.click();
            return true;
        }, selector),
        { timeout: 15_000, message: `Control ${selector} must become available` }
    ).toBe(true);
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

    const removeAllButton = page.locator("#removeAllLayersHeaderBtn");
    const removeAllIsHidden = await removeAllButton.evaluate((button) => button.hidden);
    if (removeAllIsHidden) {
        await expect(removeAllButton).toBeHidden();
    } else {
        await expect(removeAllButton).toBeVisible();
    }

    const layerPanelControls = await page.evaluate(() => {
        const panel = document.querySelector("#leftSatellitesPanel");
        const resizeHandle = panel?.querySelector(".sidebar-panel-resize-handle");
        const addLayer = document.querySelector("#objectList .object-list-add-item");
        const panelRect = panel?.getBoundingClientRect();
        const resizeHandleRect = resizeHandle?.getBoundingClientRect();
        const addLayerRect = addLayer?.getBoundingClientRect();

        return panelRect && resizeHandleRect
            ? {
                panel: panelRect.toJSON(),
                resizeHandle: { ...resizeHandleRect.toJSON(), cursor: getComputedStyle(resizeHandle).cursor },
                addLayer: addLayerRect
                    ? { ...addLayerRect.toJSON(), fontSize: Number.parseFloat(getComputedStyle(addLayer).fontSize) }
                    : null
            }
            : null;
    });

    expect(layerPanelControls, "Layer panel controls must exist").not.toBeNull();
    expect(layerPanelControls.resizeHandle.cursor, "Layer panel must expose a resize handle").toBe("col-resize");
    expect(layerPanelControls.resizeHandle.right, "Resize handle must reach the right panel edge").toBeGreaterThanOrEqual(layerPanelControls.panel.right - 1);
    if (layerPanelControls.addLayer) {
        expect(layerPanelControls.addLayer.height, "Add-layer control must remain compact").toBeLessThanOrEqual(42);
        expect(layerPanelControls.addLayer.fontSize, "Layer names must match catalog density").toBeLessThanOrEqual(12);
    }
}

async function expectCatalogLayout(page, zoom = 1) {
    const layout = await page.locator(".catalog-modal-panel").evaluate((panel, selectors) => {
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
    await page.goto("/", { waitUntil: "domcontentloaded" });

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

    await page.locator("#topConfigBtn").click();
    await expect(page.locator("#configModal")).toHaveClass(/open/);
    await expectPanelInsideViewport(page, "#configPanel");
    await expectVisibleControlsInsideViewport(page, ["#configPanel"]);
    await page.locator("#configCloseBtn").click();
    await expect(page.locator("#configModal")).not.toHaveClass(/open/);

    await page.locator("#topSimCtrlBtn").click();
    await expect(page.locator("#simulationControlDock")).toHaveClass(/open/);
    await expectPanelInsideViewport(page, "#simulationControlDock");
    await expectVisibleControlsInsideViewport(page, ["#simulationControlDock"]);
    await page.locator('#simulationControlDock [data-mode="range"]').click();
    await expectVisibleControlsInsideViewport(page, ["#simulationControlDock"]);

    await page.locator("#leftInfoBtn").click();
    await expect(page.locator("#leftInfoPanel")).toHaveClass(/open/);
    await expectPanelInsideViewport(page, "#leftInfoPanel");
    await expect(page.locator("#leftInfoPanel .sidebar-panel-close")).toHaveCount(0);
    const telemetryOverflow = await page.locator("#leftInfoPanelContent").evaluate((panel) => panel.scrollWidth > panel.clientWidth + 1);
    expect(telemetryOverflow, "Telemetry panel must not create horizontal scrolling").toBeFalsy();

});

test("El panel de capas se redimensiona y se pliega al alcanzar el mínimo", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#leftSatellitesBtn").click();
    await expect(page.locator("#leftSatellitesPanel")).toHaveClass(/open/);

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
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#leftSatellitesBtn").click();
    await clickLiveControl(page, "#leftSatellitesPanel #openCatalogBtn");
    await expect(page.locator("#layerAddMenu")).toHaveClass(/open/);
    await expect(page.locator("#addGroundStationBtn")).toBeVisible();
    await clickLiveControl(page, "#addGroundStationBtn");

    await expect(page.locator("#groundStationModal")).toHaveClass(/open/);
    await expectPanelInsideViewport(page, "#groundStationPanel");
    await expectVisibleControlsInsideViewport(page, ["#groundStationPanel"]);

    const hasHorizontalOverflow = async () => page.locator(".ground-station-tab-panel.active").evaluate((panel) => panel.scrollWidth > panel.clientWidth + 1);
    expect(await hasHorizontalOverflow(), "Ground station form must not create horizontal scrolling").toBeFalsy();

    for (const tab of ["radio", "visual", "heatmap"]) {
        await clickLiveControl(page, `[data-gs-tab="${tab}"]`);
        await expect(page.locator(`[data-gs-tab-panel="${tab}"]`)).toHaveClass(/active/);
        await expectVisibleControlsInsideViewport(page, ["#groundStationPanel"]);
        expect(await hasHorizontalOverflow(), "Ground station form must not create horizontal scrolling").toBeFalsy();
    }

    const heatmapToggle = page.locator("#gsHeatEnabledInput");
    await expect(heatmapToggle).toBeVisible();
    const heatmapToggleSize = await heatmapToggle.evaluate((input) => {
        const rect = input.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    expect(heatmapToggleSize.width, "Heat map toggle must be easy to activate").toBeGreaterThanOrEqual(22);
    expect(heatmapToggleSize.height, "Heat map toggle must be easy to activate").toBeGreaterThanOrEqual(22);
});

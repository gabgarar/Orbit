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
    "[data-testid='catalog-filters']",
    "[data-testid='catalog-refresh']",
    "[data-testid='catalog-select-all']",
    "#catalogModal button[aria-label='Cerrar']"
];
const projectActionOptions = [
    { action: "new", label: "Nuevo proyecto" },
    { action: "open", label: "Importar proyecto" },
    { action: "save", label: "Guardar proyecto" },
    { action: "export", label: "Exportar proyecto" }
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
    // The workspace sidebar receives live time updates. Querying a fresh
    // snapshot avoids pinning an evaluation to a React node that can be
    // replaced between locator resolution and execution.
    const isOpen = await page.evaluate(() => document.querySelector("#leftSatellitesPanel")?.classList.contains("open") === true);
    if (!isOpen) {
        await page.locator("#leftSatellitesBtn").click();
    }
    await expect(panel).toHaveClass(/open/);
    await expect.poll(
        () => page.evaluate(() => {
            const element = document.querySelector("#leftSatellitesPanel");
            return element ? Math.round(element.getBoundingClientRect().left) : null;
        }),
        { timeout: 5_000, message: "Layer panel must finish opening inside the viewport" }
    ).toBeGreaterThanOrEqual(-1);
}

async function expectProjectActionsMenu(page, source) {
    const menu = page.locator("#projectActionsMenu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("role", "menu");
    await expect(menu).toHaveAttribute("aria-label", "Acciones de proyecto");
    await expect(menu).toHaveAttribute("data-project-actions-source", source);
    await expectPanelInsideViewport(page, "#projectActionsMenu");
    for (const { action, label } of projectActionOptions) {
        const item = menu.locator(`[data-project-action="${action}"]`);
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute("role", "menuitem");
        await expect(item).toContainText(label);
    }
    return menu;
}

async function chooseLayerKind(page, kind) {
    await expect.poll(
        () => page.evaluate((requestedKind) => {
            const control = document.querySelector("#leftSatellitesPanel #openCatalogBtn");
            const menu = document.querySelector("#layerAddMenu");
            if (!(control instanceof HTMLButtonElement) || control.disabled || !(menu instanceof HTMLElement)) {
                return false;
            }
            if (!menu.classList.contains("open")) {
                control.click();
            }
            const action = menu.querySelector(`[data-add-kind="${requestedKind}"]`);
            if (!(action instanceof HTMLButtonElement) || action.disabled) {
                return false;
            }
            action.click();
            return true;
        }, kind),
        { timeout: 15_000, message: `Layer action '${kind}' must become available` }
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

    await expectPanelSurfaceTransparency(page, "#leftSatellitesPanel");

    // A newly-created workspace has no layers, so its destructive bulk action
    // must not be exposed. The UI hides it through CSS rather than the HTML
    // `hidden` attribute, therefore validate rendered visibility directly.
    const removeAllButton = page.locator("#removeAllLayersHeaderBtn");
    await expect(removeAllButton).toBeHidden();

    const projectRoot = page.locator("[data-layer-tree-project-root]");
    const projectTreeBody = page.locator("[data-layer-tree-project-body]");
    await expect(projectRoot).toBeVisible();
    await expect(projectRoot).toHaveAttribute("aria-expanded", "true");
    await expect(projectRoot.locator("[data-project-title]")).toBeVisible();
    await expect(projectRoot.locator(".orbit-project-layer-count")).toHaveText(/^\d+$/);
    await expect(projectTreeBody).toBeVisible();
    const readProjectTimeFooterBottom = () => page.evaluate(() => {
        const footer = document.querySelector("#projectTimeFooter");
        return footer ? footer.getBoundingClientRect().bottom : null;
    });
    // Publishing the initial workspace state may replace the React subtree
    // immediately after the locator assertion above. Read a fresh DOM snapshot
    // and wait for the stable mounted footer instead of retaining an element
    // handle that a concurrent render can detach.
    await expect.poll(readProjectTimeFooterBottom, {
        timeout: 5_000,
        message: "Project clock must mount before collapsing the tree"
    }).not.toBeNull();
    const timeFooterBottomBeforeProjectCollapse = await readProjectTimeFooterBottom();
    expect(timeFooterBottomBeforeProjectCollapse, "Project clock must exist before collapsing the tree").not.toBeNull();
    await projectRoot.click();
    await expect(projectRoot).toHaveAttribute("aria-expanded", "false");
    await expect(projectTreeBody).toBeHidden();
    await expect.poll(readProjectTimeFooterBottom, {
        timeout: 5_000,
        message: "Project clock must remain mounted when the project tree collapses"
    }).not.toBeNull();
    const timeFooterBottomAfterProjectCollapse = await readProjectTimeFooterBottom();
    expect(timeFooterBottomAfterProjectCollapse, "Project clock must remain mounted when the tree collapses").not.toBeNull();
    expect(Math.abs(timeFooterBottomAfterProjectCollapse - timeFooterBottomBeforeProjectCollapse), "Project clock must remain anchored when the project tree is collapsed").toBeLessThanOrEqual(1);
    await projectRoot.click();
    await expect(projectRoot).toHaveAttribute("aria-expanded", "true");
    await expect(projectTreeBody).toBeVisible();

    const layerPanelControls = await page.evaluate(() => {
        const panel = document.querySelector("#leftSatellitesPanel");
        const resizeHandle = panel?.querySelector(".sidebar-panel-resize-handle");
        const addLayer = panel?.querySelector("#openCatalogBtn");
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
                        label: addLayer.textContent?.trim(),
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
    expect(layerPanelControls.addLayer.height, "Add-layer control must remain a clear call to action").toBeGreaterThanOrEqual(30);
    expect(layerPanelControls.addLayer.height, "Add-layer control must remain compact").toBeLessThanOrEqual(38);
    expect(layerPanelControls.addLayer.fontSize, "Layer names must match catalog density").toBeLessThanOrEqual(12);
    expect(layerPanelControls.addLayer.label, "Add-layer control must explain its action").toContain("Añadir");
}

async function expectCatalogLayout(page, zoom = 1) {
    const layout = await page.evaluate((selectors) => {
        const panel = document.querySelector("#catalogModal > section");
        if (!panel) return null;
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

    expect(layout, "Catalog panel must exist before measuring its layout").not.toBeNull();
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
    const bounds = await page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
    }, selector);

    expect(bounds, `${selector} must exist before its viewport bounds are measured`).not.toBeNull();
    expect(bounds.left, `${selector} must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bounds.right, `${selector} must stay inside the viewport`).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.top, `${selector} must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom, `${selector} must stay inside the viewport`).toBeLessThanOrEqual(bounds.height + 1);
}

/**
 * A panel can be translucent either through its solid background colour or
 * through the stops in a gradient. Inspect the computed form of both so this
 * contract does not force a particular CSS implementation.
 */
async function expectPanelSurfaceTransparency(page, selector) {
    const presentation = await page.evaluate((targetSelector) => {
        const surface = document.querySelector(targetSelector);
        if (!surface) return null;
        const alphaValues = (value) => [...String(value || "").matchAll(/rgba?\(([^)]+)\)/gi)]
            .map((match) => {
                const components = match[1].trim().split(/[\s,/]+/).filter(Boolean);
                if (components.length < 4) return 1;
                const rawAlpha = components.at(-1);
                const alpha = Number.parseFloat(rawAlpha);
                return rawAlpha.endsWith("%") ? alpha / 100 : alpha;
            })
            .filter(Number.isFinite);
        const styles = getComputedStyle(surface);
        const hasGradient = styles.backgroundImage !== "none";
        const relevantAlphas = alphaValues(hasGradient ? styles.backgroundImage : styles.backgroundColor);
        return {
            backgroundColor: styles.backgroundColor,
            backgroundImage: styles.backgroundImage,
            opacity: Number(styles.opacity),
            isTranslucent: relevantAlphas.some((alpha) => alpha < 0.99)
        };
    }, selector);

    expect(presentation, `${selector} must exist before its surface is inspected`).not.toBeNull();
    expect(presentation.isTranslucent, `${selector} must keep a subtly translucent surface`).toBeTruthy();
    // Make the surface translucent rather than reducing opacity for all its
    // content; labels and controls must remain fully legible.
    expect(presentation.opacity, `${selector} content must remain fully opaque`).toBeGreaterThanOrEqual(0.99);
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

test("Las acciones de proyecto estan disponibles desde Layers y su raiz", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);

    const projectActionsButton = page.locator("#projectActionsBtn");
    const projectRoot = page.locator("[data-layer-tree-project-root]");
    await expect(projectActionsButton).toBeVisible();
    await expect(projectActionsButton).toHaveAccessibleName("Acciones de proyecto");
    await expect(projectActionsButton).toHaveAttribute("aria-haspopup", "menu");
    await expect(projectActionsButton).toHaveAttribute("aria-expanded", "false");
    await expect(projectActionsButton.locator("svg")).toHaveCount(1);

    await projectActionsButton.click();
    const toolbarMenu = await expectProjectActionsMenu(page, "toolbar");
    await expect(projectActionsButton).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(toolbarMenu).toHaveCount(0);
    await expect(projectActionsButton).toHaveAttribute("aria-expanded", "false");

    // Capture the bridge event before its normal bubble listener. The menu
    // contract can then verify all commands without opening file pickers,
    // triggering downloads, or replacing the workspace under test.
    await page.evaluate(() => {
        const events = [];
        const listener = (event) => {
            events.push(String(event.detail || ""));
            event.stopImmediatePropagation();
        };
        window.__orbitProjectActionsMenuTest = { events, listener };
        window.addEventListener("orbit:project-action", listener, true);
    });
    try {
        for (const { action } of projectActionOptions) {
            await projectActionsButton.click();
            const menu = await expectProjectActionsMenu(page, "toolbar");
            await menu.locator(`[data-project-action="${action}"]`).click();
            await expect(menu).toHaveCount(0);
        }
        const dispatchedActions = await page.evaluate(() => window.__orbitProjectActionsMenuTest.events);
        expect(dispatchedActions).toEqual(projectActionOptions.map(({ action }) => action));
    } finally {
        await page.evaluate(() => {
            const probe = window.__orbitProjectActionsMenuTest;
            if (probe) window.removeEventListener("orbit:project-action", probe.listener, true);
            delete window.__orbitProjectActionsMenuTest;
        });
    }

    await expect(projectRoot).toBeVisible();
    await projectRoot.click({ button: "right" });
    const contextMenu = await expectProjectActionsMenu(page, "context");
    await expect(projectActionsButton).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await expect(contextMenu).toHaveCount(0);
});

test("Los paneles principales mantienen controles accesibles", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);

    await expect(page.locator("#topToolbar")).toBeVisible();
    await expect(page.locator("#leftSidebar")).toBeVisible();
    await expectVisibleControlsInsideViewport(page, ["#topToolbar", "#leftSidebar"]);
    await expectPanelSurfaceTransparency(page, "#leftSidebar");

    const shellChrome = await page.evaluate(() => {
        const parseColor = (value) => {
            const channels = value.match(/[\d.]+/g)?.map(Number) || [];
            const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
            return {
                red,
                green,
                blue,
                alpha,
                brightness: (red * 0.299) + (green * 0.587) + (blue * 0.114)
            };
        };
        const toolbar = document.querySelector("#topToolbar");
        const sidebar = document.querySelector("#leftSidebar");
        const firstIcon = sidebar?.querySelector(".sidebar-btn");
        const toolbarStyles = toolbar ? getComputedStyle(toolbar) : null;
        const readableToolbarElements = [
            ".toolbar-brand",
            ".toolbar-nav-link[aria-current='page']",
            "#objectSearch",
            "#topNotificationsBtn",
            '[aria-label="Panel de ayuda"]',
            "#topSettingsBtn",
            "#topUserBtn"
        ].map((selector) => {
            const element = toolbar?.querySelector(selector);
            const styles = element ? getComputedStyle(element) : null;
            const rect = element?.getBoundingClientRect();
            return {
                selector,
                foreground: parseColor(styles?.color || ""),
                opacity: Number(styles?.opacity || 0),
                width: rect?.width || 0,
                height: rect?.height || 0
            };
        });
        return {
            toolbarBackground: parseColor(toolbarStyles?.backgroundColor || ""),
            toolbarBackgroundImage: toolbarStyles?.backgroundImage || "",
            toolbarBoxShadow: toolbarStyles?.boxShadow || "",
            toolbarBackdropFilter: toolbarStyles?.backdropFilter || "",
            readableToolbarElements,
            sidebarWidth: sidebar?.getBoundingClientRect().width || 0,
            iconSize: firstIcon?.getBoundingClientRect().width || 0
        };
    });

    // The restored header uses Orbit's original dark gradient and elevation,
    // while its controls stay readable at every responsive breakpoint.
    expect(shellChrome.toolbarBackgroundImage, "Top toolbar must retain its dark gradient").toMatch(/linear-gradient/i);
    expect(shellChrome.toolbarBoxShadow, "Top toolbar must retain its original elevation").not.toBe("none");
    expect(shellChrome.toolbarBackdropFilter, "Top toolbar must not blur the scene behind it").toBe("none");
    for (const control of shellChrome.readableToolbarElements) {
        expect(control.width, `${control.selector} must remain visible`).toBeGreaterThan(10);
        expect(control.height, `${control.selector} must remain visible`).toBeGreaterThan(10);
        expect(control.opacity, `${control.selector} must remain visible`).toBeGreaterThan(0.95);
        expect(control.foreground.alpha, `${control.selector} must use an opaque foreground`).toBeGreaterThan(0.95);
        expect(control.foreground.brightness, `${control.selector} must remain legible over the scene`).toBeGreaterThan(100);
    }
    expect(shellChrome.sidebarWidth, "The left icon rail must remain comfortably wide").toBeGreaterThanOrEqual(46);
    expect(shellChrome.iconSize, "The left rail icons must have a usable target size").toBeGreaterThanOrEqual(38);

    const layersButton = page.locator("#leftSatellitesBtn");
    const layersPanel = page.locator("#leftSatellitesPanel");
    await expect(layersButton).toHaveAccessibleName("Capas y satelites");
    const layersGlyph = layersButton.locator("svg");
    await expect(layersGlyph).toHaveCount(1);
    await expect(layersGlyph).toHaveAttribute("aria-hidden", "true");
    const layersGlyphShape = await layersGlyph.evaluate((svg) => ({
        pathCount: svg.querySelectorAll("path").length,
        fills: [...svg.querySelectorAll("path")].map((path) => path.getAttribute("fill")),
        hasRotatedSatelliteGroup: Boolean(svg.querySelector('g[transform*="rotate"]'))
    }));
    // The rail trigger is intentionally labelled as Layers, and its supplied
    // mark is the three filled strata rather than the former rotated satellite.
    expect(layersGlyphShape.pathCount).toBe(3);
    expect(layersGlyphShape.fills.every(Boolean)).toBeTruthy();
    expect(layersGlyphShape.hasRotatedSatelliteGroup).toBeFalsy();
    await layersButton.click();
    await expect(layersPanel).not.toHaveClass(/open/);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open: true } })));
    await expect(layersPanel).toHaveClass(/open/);
    await expect(layersButton).toHaveClass(/active/);
    await expectPanelSurfaceTransparency(page, "#leftSatellitesPanel");

    await page.locator("#topSettingsBtn").click();
    await expect(page.locator("#configModal")).toHaveClass(/open/);
    await expectPanelSurfaceTransparency(page, "#configPanel");
    await expectPanelInsideViewport(page, "#configPanel");
    await expectVisibleControlsInsideViewport(page, ["#configPanel"]);
    await page.locator("#configPanel").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.locator("#configModal")).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("orbit:selected-object", {
        detail: {
            id: "transparency-regression",
            selectionRevision: 1,
            name: "Transparency regression",
            layerType: "SATELLITE",
            active: true,
            visible: true,
            telemetry: { norad_id: "00001" }
        }
    })));
    const objectDetails = page.locator(".object-details-panel");
    await expect(objectDetails).toBeVisible();
    await expectPanelSurfaceTransparency(page, ".object-details-panel");

    const projectTimeFooter = page.locator("#projectTimeFooter");
    const simulationDock = page.locator(".react-simulation-dock");
    const currentMode = (name) => projectTimeFooter.getByRole("button", { name, exact: true });
    const modeButton = page.locator("#projectTimeModeBtn");
    const chooseMode = async (from, to) => {
        await currentMode(from).click();
        await page.getByRole("menuitemradio", { name: to, exact: true }).click();
        await expect(currentMode(to)).toBeVisible();
    };

    await expect(projectTimeFooter).toBeVisible();
    await expectVisibleControlsInsideViewport(page, ["#projectTimeFooter"]);
    const projectTimeFooterPresentation = await projectTimeFooter.evaluate((footer) => {
        const parseColor = (value) => {
            const channels = value.match(/[\d.]+/g)?.map(Number) || [];
            const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
            return {
                red,
                green,
                blue,
                alpha,
                brightness: (red * 0.299) + (green * 0.587) + (blue * 0.114)
            };
        };
        const styles = getComputedStyle(footer);
        const date = footer.querySelector("small");
        const time = footer.querySelector("strong");
        return {
            background: parseColor(styles.backgroundColor),
            backgroundImage: styles.backgroundImage,
            date: {
                text: date?.textContent?.trim() || "",
                foreground: parseColor(date ? getComputedStyle(date).color : "")
            },
            time: {
                text: time?.textContent?.trim() || "",
                foreground: parseColor(time ? getComputedStyle(time).color : "")
            }
        };
    });
    // The project clock is deliberately part of the transparent panel chrome:
    // it must not reinstate a solid card or an opaque gradient behind the map.
    expect(projectTimeFooterPresentation.background.alpha).toBeLessThanOrEqual(0.05);
    expect(projectTimeFooterPresentation.backgroundImage).toBe("none");
    // Removing its surface must not make the date/time disappear into the
    // scene. Keep both values present and intentionally light.
    expect(projectTimeFooterPresentation.date.text).toMatch(/^\d{2} [A-Za-z]{3} \d{4}$/);
    expect(projectTimeFooterPresentation.time.text).toMatch(/^\d{2}:\d{2}:\d{2} UTC$/);
    expect(projectTimeFooterPresentation.date.foreground.brightness).toBeGreaterThan(140);
    expect(projectTimeFooterPresentation.time.foreground.brightness).toBeGreaterThan(180);
    await expect(currentMode("Real time")).toBeVisible();
    await expect(modeButton).toHaveAttribute("aria-haspopup", "menu");
    await expect(modeButton).toHaveAttribute("aria-expanded", "false");
    // A chevron is an icon, not a fallback text glyph such as ^ or ⌄.
    await expect(modeButton.locator("svg")).toHaveCount(1);
    await expect(modeButton.locator("svg")).toHaveAttribute("aria-hidden", "true");
    const fallbackChevronText = await modeButton.evaluate((button) => [...button.querySelectorAll("span")]
        .map((span) => span.textContent?.trim() || "")
        .filter((text) => /^[\^⌃⌄∨]$/u.test(text)));
    expect(fallbackChevronText).toEqual([]);
    await expect(simulationDock).toBeHidden();

    await currentMode("Real time").click();
    const modeMenu = page.getByRole("menu", { name: "Modo temporal", exact: true });
    await expect(modeButton).toHaveAttribute("aria-expanded", "true");
    await expect(modeMenu).toBeVisible();
    await expectPanelInsideViewport(page, "#projectTimeFooter [role='menu']");
    const modeMenuPresentation = await modeMenu.evaluate((menu) => {
        const inspectColor = (value) => {
            const channels = value.match(/[\d.]+/g)?.map(Number) || [];
            const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
            return {
                red,
                green,
                blue,
                alpha,
                brightness: (red * 0.299) + (green * 0.587) + (blue * 0.114)
            };
        };
        const inspectOption = (element) => {
            const styles = getComputedStyle(element);
            return {
                label: element.textContent?.trim() || "option",
                selected: element.getAttribute("aria-checked") === "true",
                background: inspectColor(styles.backgroundColor),
                foreground: inspectColor(styles.color)
            };
        };
        return {
            menuBackground: inspectColor(getComputedStyle(menu).backgroundColor),
            options: [...menu.querySelectorAll('[role="menuitemradio"]')].map(inspectOption)
        };
    });
    // The menu floats over the panel rather than introducing another opaque
    // card. Normal choices must remain legible, while the active one keeps a
    // clear blue selection treatment.
    expect(modeMenuPresentation.menuBackground.alpha).toBeLessThan(0.9);
    const selectedModeOption = modeMenuPresentation.options.find((option) => option.selected);
    const normalModeOptions = modeMenuPresentation.options.filter((option) => !option.selected);
    expect(selectedModeOption).toBeDefined();
    expect(normalModeOptions).toHaveLength(2);
    for (const option of normalModeOptions) {
        expect(option.foreground.brightness, `${option.label} must use a light text colour`).toBeGreaterThan(140);
    }
    expect(selectedModeOption.foreground.brightness).toBeGreaterThan(140);
    expect(selectedModeOption.background.alpha).toBeGreaterThanOrEqual(0.9);
    expect(selectedModeOption.background.blue).toBeGreaterThan(selectedModeOption.background.red);
    expect(selectedModeOption.background.blue).toBeGreaterThan(selectedModeOption.background.green);
    await expect(page.getByRole("menuitemradio", { name: "Static", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "Real time", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "Simulated", exact: true })).toBeVisible();
    await page.getByRole("menuitemradio", { name: "Static", exact: true }).click();
    await expect(currentMode("Static")).toBeVisible();
    await expect(simulationDock).toBeHidden();

    await chooseMode("Static", "Simulated");
    await expect(simulationDock).toBeVisible();
    await expectPanelSurfaceTransparency(page, ".react-simulation-dock");
    await expectPanelInsideViewport(page, ".react-simulation-dock");
    await expect(page.getByRole("slider", { name: "Linea temporal de simulacion" })).toBeVisible();
    await expectVisibleControlsInsideViewport(page, [".react-simulation-dock"]);
    await expect(simulationDock.getByRole("button", { name: "Grabar sesion", exact: true })).toHaveCount(0);

    const readTimeLayout = () => page.evaluate(() => {
        const rect = (element) => {
            if (!element) return null;
            const bounds = element.getBoundingClientRect();
            return {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
                height: bounds.height,
                centerY: bounds.top + (bounds.height / 2)
            };
        };
        const footer = document.getElementById("projectTimeFooter");
        return {
            panel: rect(document.getElementById("leftSatellitesPanel")),
            footer: rect(footer),
            dock: rect(document.querySelector(".react-simulation-dock")),
            clock: rect(footer?.querySelector("small")?.parentElement),
            mode: rect(document.getElementById("projectTimeModeBtn"))
        };
    });
    await expect.poll(
        async () => {
            const layout = await readTimeLayout();
            return layout.footer && layout.dock ? Math.abs(layout.dock.bottom - layout.footer.bottom) : Number.POSITIVE_INFINITY;
        },
        { message: "Simulation dock must settle on the raised project footer" }
    ).toBeLessThanOrEqual(1);
    const timeLayout = await readTimeLayout();
    expect(timeLayout.panel, "Layers panel must exist for time alignment").not.toBeNull();
    expect(timeLayout.footer, "Project time footer must exist for time alignment").not.toBeNull();
    expect(timeLayout.dock, "Simulation dock must exist for time alignment").not.toBeNull();
    expect(timeLayout.clock, "Date and time block must exist").not.toBeNull();
    expect(timeLayout.mode, "Time mode control must exist").not.toBeNull();
    // The clock card stays deliberately compact after moving down with the
    // dock, rather than reclaiming the tall former footer treatment.
    expect(timeLayout.footer.height, "Project time footer must remain compact").toBeGreaterThanOrEqual(48);
    expect(timeLayout.footer.height, "Project time footer must remain compact").toBeLessThanOrEqual(64);
    // The clock is a raised footer strip: it leaves a small lower inset below
    // the Layers tree, and the dock follows that same baseline.
    const footerInset = timeLayout.panel.bottom - timeLayout.footer.bottom;
    expect(footerInset, "Project time footer must sit above the lower Layers edge").toBeGreaterThanOrEqual(8);
    expect(footerInset, "Project time footer must remain visually close to the Layers edge").toBeLessThanOrEqual(16);
    expect(Math.abs(timeLayout.dock.bottom - timeLayout.footer.bottom), "Clock and simulation dock must share the raised footer position").toBeLessThanOrEqual(1);
    expect(Math.abs(timeLayout.clock.centerY - timeLayout.footer.centerY), "Date/time block must stay balanced in its compact footer").toBeLessThanOrEqual(5);
    expect(Math.abs(timeLayout.mode.centerY - timeLayout.footer.centerY), "Time mode control must stay balanced in its compact footer").toBeLessThanOrEqual(5);

    const hideSimulationDock = page.getByRole("button", { name: "Ocultar control de simulacion", exact: true });
    await expect(hideSimulationDock).toBeVisible();
    await hideSimulationDock.click();
    const showSimulationDock = page.getByRole("button", { name: "Mostrar control de simulacion", exact: true });
    await expect(showSimulationDock).toBeVisible();
    const readCollapsedTogglePosition = () => page.evaluate(() => {
        const toggle = document.querySelector('button[aria-label="Mostrar control de simulacion"]');
        const bounds = toggle?.getBoundingClientRect();
        return bounds ? { left: bounds.left, bottom: bounds.bottom } : null;
    });
    await expect.poll(
        readCollapsedTogglePosition,
        { message: "Collapsed simulation toggle must settle beside the dock origin" }
    ).not.toBeNull();
    const collapsedTogglePosition = await readCollapsedTogglePosition();
    expect(collapsedTogglePosition, "Collapsed simulation toggle must be measurable").not.toBeNull();
    expect(Math.abs(collapsedTogglePosition.left - timeLayout.dock.left), "Collapsed simulation toggle must remain at the dock's left edge").toBeLessThanOrEqual(1);
    expect(Math.abs(collapsedTogglePosition.bottom - timeLayout.dock.bottom), "Collapsed simulation toggle must retain the dock's lower alignment").toBeLessThanOrEqual(1);
    await showSimulationDock.click();
    await expect(hideSimulationDock).toBeVisible();

    const simulationControlPresentation = await simulationDock.evaluate((dock) => {
        const parseColor = (value) => {
            const channels = value.match(/[\d.]+/g)?.map(Number) || [];
            const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
            return { red, green, blue, alpha };
        };
        const controls = [
            ["rewind", 'button[aria-label="Reiniciar"]'],
            ["playback", 'button[aria-label="Pausar"], button[aria-label="Reproducir"]'],
            ["speed", 'button[aria-haspopup="menu"]'],
            ["date-range", 'button[aria-label="Elegir rango de fechas"]']
        ];
        return controls.map(([name, selector]) => {
            const control = dock.querySelector(selector);
            const styles = control ? getComputedStyle(control) : null;
            const rect = control?.getBoundingClientRect();
            return {
                name,
                exists: Boolean(control),
                width: rect?.width || 0,
                height: rect?.height || 0,
                background: parseColor(styles?.backgroundColor || ""),
                backgroundImage: styles?.backgroundImage || "",
                hasSvgIcon: Boolean(control?.querySelector("svg"))
            };
        });
    });
    // The four primary controls form a compact, uniform rail. They remain
    // square targets, but the glyphs are intentionally flat: no blue tiles
    // or emoji fallback symbols sit behind them.
    expect(simulationControlPresentation).toHaveLength(4);
    const referenceControl = simulationControlPresentation[0];
    for (const control of simulationControlPresentation) {
        expect(control.exists, `${control.name} control must exist`).toBeTruthy();
        expect(control.width, `${control.name} control must have a usable target`).toBeGreaterThanOrEqual(28);
        expect(Math.abs(control.width - control.height), `${control.name} control must be square`).toBeLessThanOrEqual(1);
        expect(Math.abs(control.width - referenceControl.width), `${control.name} control must match the other control widths`).toBeLessThanOrEqual(1);
        expect(Math.abs(control.height - referenceControl.height), `${control.name} control must match the other control heights`).toBeLessThanOrEqual(1);
        expect(control.background.alpha, `${control.name} control must remain transparent`).toBeLessThanOrEqual(0.05);
        expect(control.backgroundImage, `${control.name} control must not use a gradient`).toBe("none");
    }
    for (const control of simulationControlPresentation.filter((control) => control.name !== "speed")) {
        expect(control.hasSvgIcon, `${control.name} must use a flat SVG icon`).toBeTruthy();
    }

    await simulationDock.getByRole("button", { name: "Elegir rango de fechas", exact: true }).click();
    const dateRangeDialog = page.getByRole("dialog", { name: "Seleccionar rango temporal", exact: true });
    await expect(dateRangeDialog).toBeVisible();
    const dateRangeLayering = await dateRangeDialog.evaluate((dialog) => {
        const dock = dialog.closest(".react-simulation-dock");
        const layers = document.getElementById("leftSatellitesPanel");
        return {
            dockZIndex: Number(getComputedStyle(dock).zIndex),
            layersZIndex: Number(getComputedStyle(layers).zIndex)
        };
    });
    expect(dateRangeLayering.dockZIndex).toBeGreaterThan(dateRangeLayering.layersZIndex);

    await chooseMode("Simulated", "Real time");
    await expect(simulationDock).toBeHidden();

    const recordButton = page.locator("#leftRecordBtn");
    const cameraButton = page.locator("#leftCameraControlsBtn");
    await expect(recordButton).toBeVisible();
    await expect(recordButton).toHaveAccessibleName("Grabar sesion");
    await expect(cameraButton).toBeVisible();
    const recordPlacement = await page.locator("#leftSidebar").evaluate((rail) => {
        const record = rail.querySelector("#leftRecordBtn");
        const camera = rail.querySelector("#leftCameraControlsBtn");
        if (!record || !camera) return null;
        const recordRect = record.getBoundingClientRect();
        const cameraRect = camera.getBoundingClientRect();
        return {
            beforeCamera: Boolean(record.compareDocumentPosition(camera) & Node.DOCUMENT_POSITION_FOLLOWING),
            recordBottom: recordRect.bottom,
            cameraTop: cameraRect.top
        };
    });
    expect(recordPlacement).not.toBeNull();
    expect(recordPlacement.beforeCamera).toBeTruthy();
    expect(recordPlacement.recordBottom).toBeLessThanOrEqual(recordPlacement.cameraTop + 1);

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

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("orbit:heat-legend", { detail: true })));
    const heatLegend = page.locator("#groundStationHeatLegend");
    await expect(heatLegend).toBeVisible();
    await expectPanelSurfaceTransparency(page, "#groundStationHeatLegend");
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
    await expect.poll(
        () => page.evaluate(() => {
            const control = document.querySelector("#leftSatellitesPanel #openCatalogBtn");
            const menu = document.querySelector("#layerAddMenu");
            if (!(control instanceof HTMLButtonElement) || control.disabled || !(menu instanceof HTMLElement)) {
                return false;
            }
            if (!menu.classList.contains("open")) {
                control.click();
            }
            const action = menu.querySelector("#generateOrbitBtn");
            if (!(action instanceof HTMLButtonElement) || action.disabled) {
                return false;
            }
            action.click();
            return true;
        }),
        { timeout: 15_000, message: "Generate orbit action must become available" }
    ).toBe(true);

    const designer = page.locator("#manualOrbitPanel");
    await expect(designer).toBeVisible();
    await expectPanelSurfaceTransparency(page, "#manualOrbitPanel");
    // The designer owns an isolated Earth-centred scene. Layers must be
    // genuinely hidden (not merely translated off-screen) while it is open,
    // then restored to its prior expanded state when the draft is closed.
    await expect(page.locator("#leftSatellitesPanel")).toBeHidden();
    await expect(page.locator("#leftSatellitesBtn")).toBeHidden();
    await expect(page.locator("#manualOrbitCentralBody")).toContainText("Earth");
    await expect.poll(() => page.evaluate(() => ({
        active: window.__orbitManualOrbitDesignActive === true,
        dataset: document.documentElement.dataset.manualOrbitDesign
    }))).toEqual({ active: true, dataset: "true" });
    const vectors = designer.getByRole("button", { name: "Ver ejes y vectores", exact: true });
    await expect(vectors).toBeVisible();
    await page.evaluate(() => Array.from(document.querySelectorAll("#manualOrbitPanel button"))
        .find((button) => button.textContent?.trim() === "Ver ejes y vectores")?.click());
    await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll("#manualOrbitPanel button"))
        .some((button) => button.textContent?.trim() === "Ocultar ejes y vectores"))).toBe(true);
    await expect(page.locator("#leftPropagatedParametersBtn")).toBeEnabled();

    await page.evaluate(() => window.dispatchEvent(new CustomEvent("orbit:propagated-parameters-open", {
        detail: { id: "transparency-regression", name: "Transparency regression" }
    })));
    const propagatedParameters = page.locator(".propagated-orbit-parameters-panel");
    await expect(propagatedParameters).toBeVisible();
    await expectPanelSurfaceTransparency(page, ".propagated-orbit-parameters-panel");

    await designer.getByRole("button", { name: /Cerrar creador de .rbita manual/ }).click();
    await expect(designer).toBeHidden();
    await expect(page.locator("#leftSatellitesPanel")).toBeVisible();
    await expect(page.locator("#leftSatellitesPanel")).toHaveClass(/open/);
    await expect(page.locator("#leftSatellitesBtn")).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
        active: window.__orbitManualOrbitDesignActive === true,
        dataset: document.documentElement.dataset.manualOrbitDesign
    }))).toEqual({ active: false, dataset: "false" });
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

import { expect, test } from "@playwright/test";
import {
    createLocalIdentityThroughUi,
    createProjectThroughHub,
    openWorkspaceThroughLocalIdentity,
    waitForAuthenticatedProjectHub
} from "./helpers/identity-workspace.js";

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
 * Each Playwright test receives a clean browser context. Enter the workspace
 * through the mandatory identity gate and the authenticated project library
 * before interacting with controls behind the project surface.
 */
async function openWorkspace(page) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openWorkspaceThroughLocalIdentity(page, `Responsive workspace ${++workspaceSequence}`);
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
                        accessibleName: addLayer.getAttribute("aria-label") || addLayer.getAttribute("title") || "",
                        hasIcon: Boolean(addLayer.querySelector("svg")),
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
    expect(layerPanelControls.addLayer.height, "Add-layer control must remain a clear header action").toBeGreaterThanOrEqual(24);
    expect(layerPanelControls.addLayer.height, "Add-layer control must retain a compact header target").toBeLessThanOrEqual(36);
    expect(layerPanelControls.addLayer.fontSize, "Add-layer control must match compact catalog density").toBeLessThanOrEqual(12);
    expect(layerPanelControls.addLayer.hasIcon, "Add-layer control must expose a visible plus icon").toBeTruthy();
    expect(layerPanelControls.addLayer.accessibleName, "Icon-only add-layer control must retain an accessible label").toContain("Añadir");
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
 * The left rail is intentionally a compact visual navigation system rather
 * than a collection of anonymous icon targets.  Keep its measurements here
 * as a rendered contract: the implementation may use Tailwind or the legacy
 * theme stylesheet, but users must see the same centred icon/label blocks.
 */
async function readSidebarNavigationBlocks(page) {
    return page.evaluate(() => {
        const isVisible = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none"
                && style.visibility !== "hidden"
                && Number(style.opacity) > 0
                && rect.width > 0
                && rect.height > 0;
        };
        const color = (element) => {
            const value = getComputedStyle(element).color;
            const channels = value.match(/[\d.]+/g)?.map(Number) || [];
            return {
                value,
                red: channels[0] ?? 0,
                green: channels[1] ?? 0,
                blue: channels[2] ?? 0,
                alpha: channels[3] ?? 1,
                opacity: Number(getComputedStyle(element).opacity || 1)
            };
        };
        const snapshot = (element) => {
            if (!(element instanceof Element)) return null;
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                centerX: rect.left + (rect.width / 2)
            };
        };
        const rail = document.querySelector("#leftSidebar");
        if (!(rail instanceof HTMLElement)) return null;
        const railStyles = getComputedStyle(rail);
        return {
            rail: snapshot(rail),
            rowGap: Number.parseFloat(railStyles.rowGap || railStyles.gap),
            blocks: [...rail.querySelectorAll(".sidebar-btn")]
                .filter(isVisible)
                .map((button) => {
                    const icon = button.querySelector(".sidebar-btn-icon, svg");
                    const label = button.querySelector(".sidebar-btn-label");
                    const separatorStyles = getComputedStyle(button, "::after");
                    return {
                        id: button.id,
                        active: button.classList.contains("active"),
                        disabled: button.matches(":disabled"),
                        button: snapshot(button),
                        icon: snapshot(icon),
                        label: snapshot(label),
                        iconColor: icon ? color(icon) : null,
                        labelColor: label ? color(label) : null,
                        labelText: label?.textContent?.trim() || "",
                        labelTextTransform: label ? getComputedStyle(label).textTransform : "",
                        separator: {
                            content: separatorStyles.content,
                            display: separatorStyles.display,
                            height: Number.parseFloat(separatorStyles.height),
                            bottom: Number.parseFloat(separatorStyles.bottom),
                            backgroundImage: separatorStyles.backgroundImage
                        }
                    };
                })
        };
    });
}

/**
 * The Layers navigator is composed from a React rail and a legacy-backed
 * content pane.  Both live in one workspace shell: the rail occupies the
 * left column, the content starts after its divider, and the project clock
 * belongs to that same column.
 *
 * Keep this geometry based so the implementation can use a border, a pseudo
 * element or a backdrop layer for the divider without changing the contract.
 */
async function readIntegratedLayersShell(page) {
    return page.evaluate(() => {
        const snapshot = (element) => {
            if (!(element instanceof HTMLElement)) return null;
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") return null;
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                borderTopWidth: Number.parseFloat(style.borderTopWidth),
                borderRightWidth: Number.parseFloat(style.borderRightWidth),
                borderBottomWidth: Number.parseFloat(style.borderBottomWidth),
                borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
                borderTopColor: style.borderTopColor,
                borderRightColor: style.borderRightColor,
                borderBottomColor: style.borderBottomColor,
                borderLeftColor: style.borderLeftColor,
                zIndex: style.zIndex
            };
        };
        const pseudo = (element, name) => {
            if (!(element instanceof HTMLElement)) return null;
            const style = getComputedStyle(element, name);
            return {
                content: style.content,
                display: style.display,
                width: Number.parseFloat(style.width),
                height: Number.parseFloat(style.height),
                top: style.top,
                right: style.right,
                bottom: style.bottom,
                left: style.left,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
                borderRightWidth: Number.parseFloat(style.borderRightWidth),
                borderLeftColor: style.borderLeftColor,
                borderRightColor: style.borderRightColor
            };
        };
        const shell = document.querySelector("#leftWorkspaceShell");
        const rail = document.querySelector("#leftSidebar");
        const panel = document.querySelector("#leftSatellitesPanel");
        const header = panel?.querySelector(".orbit-layers-panel-header");
        const heading = panel?.querySelector(".orbit-layers-heading");
        const search = panel?.querySelector(".orbit-layers-search");
        const project = panel?.querySelector(".orbit-project-module");
        const tree = panel?.querySelector("#leftSatellitesPanelContent");
        const footer = panel?.querySelector("#projectTimeFooter");
        const footerContent = footer?.querySelector(".project-time-footer__calendar");
        const footerMode = footer?.querySelector("#projectTimeModeBtn");
        const projectMenu = panel?.querySelector("#projectActionsBtn");

        return {
            shell: snapshot(shell),
            rail: snapshot(rail),
            panel: snapshot(panel),
            header: snapshot(header),
            heading: snapshot(heading),
            search: snapshot(search),
            project: snapshot(project),
            tree: snapshot(tree),
            footer: snapshot(footer),
            footerContent: snapshot(footerContent),
            footerMode: snapshot(footerMode),
            projectMenu: snapshot(projectMenu),
            shellAfter: pseudo(shell, "::after"),
            shellBefore: pseudo(shell, "::before"),
            railAfter: pseudo(rail, "::after"),
            railBefore: pseudo(rail, "::before"),
            panelAfter: pseudo(panel, "::after"),
            panelBefore: pseudo(panel, "::before")
        };
    });
}

/**
 * Read only the stable, outer chrome of a primary application surface.  The
 * individual panels may contain legacy and React controls, but their frame
 * must speak one visual language: one technical rule, one UI font and clean
 * whole-pixel corners.  `frameEdge` lets the full-width toolbar participate
 * through its only visible structural edge (the lower rule).
 */
async function readPrimaryChromeSurface(page, selector, frameEdge) {
    return page.locator(selector).evaluate((element, edge) => {
        const style = getComputedStyle(element);
        const edgeName = `${edge.charAt(0).toUpperCase()}${edge.slice(1)}`;
        const radiusProperties = [
            "borderTopLeftRadius",
            "borderTopRightRadius",
            "borderBottomRightRadius",
            "borderBottomLeftRadius"
        ];
        return {
            selector: element.id ? `#${element.id}` : `.${String(element.className || "").split(/\s+/)[0]}`,
            frameEdge: edge,
            borderWidth: Number.parseFloat(style[`border${edgeName}Width`]),
            borderColor: style[`border${edgeName}Color`],
            fontFamily: style.fontFamily,
            radii: radiusProperties.map((property) => Number.parseFloat(style[property]))
        };
    }, frameEdge);
}

function expectSharedPrimaryChrome(reference, candidate, label) {
    expect(candidate.borderWidth, `${label} must retain the shared 1 px technical frame`).toBeCloseTo(reference.borderWidth, 3);

    const referenceColor = readRgbChannels(reference.borderColor);
    const candidateColor = readRgbChannels(candidate.borderColor);
    for (const channel of ["red", "green", "blue", "alpha"]) {
        expect(
            candidateColor[channel],
            `${label} must use the same computed ${channel} channel as the shared technical frame`
        ).toBeCloseTo(referenceColor[channel], 3);
    }

    expect(candidate.fontFamily, `${label} must inherit the common application UI font`).toBe(reference.fontFamily);
    for (const radius of candidate.radii) {
        expect(Number.isFinite(radius), `${label} corner radius must be measurable`).toBeTruthy();
        expect(radius, `${label} corner radius must use an integer CSS pixel value`).toBeCloseTo(Math.round(radius), 5);
    }
    expect(
        new Set(candidate.radii).size,
        `${label} must use a uniform radius on all four outer corners`
    ).toBe(1);
}

function hasVisibleVerticalDivider(candidate, minHeight) {
    if (!candidate || candidate.content === "none" || candidate.display === "none") return false;
    const width = Math.max(candidate.width || 0, candidate.borderLeftWidth || 0, candidate.borderRightWidth || 0);
    const top = Number.parseFloat(candidate.top);
    const bottom = Number.parseFloat(candidate.bottom);
    const spansContainer = Number.isFinite(top)
        && Number.isFinite(bottom)
        && Math.abs(top) <= 1
        && Math.abs(bottom) <= 1;
    const decorated = candidate.backgroundImage !== "none"
        || readRgbChannels(candidate.backgroundColor).alpha > 0
        || readRgbChannels(candidate.borderLeftColor).alpha > 0
        || readRgbChannels(candidate.borderRightColor).alpha > 0;
    return width >= 1 && ((candidate.height || 0) >= minHeight || spansContainer) && decorated;
}

function isVisibleTechnicalFrameEdge(width, color) {
    const serialized = String(color || "").trim().toLowerCase();
    const channels = readRgbChannels(color);
    // A technical frame is deliberately cool grey-blue: it must be visible,
    // but should not turn into a saturated navigation accent. Treat the CSS
    // keyword `transparent` explicitly because its numeric fallback is 0.
    return width >= 1
        && serialized !== "transparent"
        && channels.alpha > .2
        && channels.green >= channels.red + 8
        && channels.blue >= channels.green + 12;
}

function rectanglesOverlap(first, second) {
    if (!first || !second) return false;
    return first.left < second.right - 0.5
        && first.right > second.left + 0.5
        && first.top < second.bottom - 0.5
        && first.bottom > second.top + 0.5;
}

function expectOrbitSidebarColor(actual, expected, label) {
    expect(actual, `${label} colour must be measurable`).not.toBeNull();
    expect(actual.red, `${label} red channel`).toBeCloseTo(expected.red, 0);
    expect(actual.green, `${label} green channel`).toBeCloseTo(expected.green, 0);
    expect(actual.blue, `${label} blue channel`).toBeCloseTo(expected.blue, 0);
}

/**
 * Rendered visual contract for the Layers explorer.  The tree itself is
 * still supplied by the legacy runtime, while the shell comes from React, so
 * use real computed styles instead of asserting either implementation's
 * class list.  This catches an accidental fallback to browser/default
 * controls as well as visual regressions in the compact explorer hierarchy.
 */
async function readLayersExplorerPresentation(page) {
    return page.evaluate(() => {
        const snapshot = (element) => {
            if (!(element instanceof Element)) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                borderTopColor: style.borderTopColor,
                borderBottomColor: style.borderBottomColor,
                borderBottomStyle: style.borderBottomStyle,
                borderBottomWidth: Number.parseFloat(style.borderBottomWidth),
                borderRadius: Number.parseFloat(style.borderTopLeftRadius),
                boxShadow: style.boxShadow,
                color: style.color,
                fontFamily: style.fontFamily,
                fontSize: Number.parseFloat(style.fontSize),
                fontWeight: Number.parseFloat(style.fontWeight)
            };
        };
        const panel = document.querySelector("#leftSatellitesPanel");
        const header = panel?.querySelector(".orbit-layers-panel-header");
        const heading = panel?.querySelector(".orbit-layers-heading");
        const add = panel?.querySelector("#openCatalogBtn");
        const addIcon = add?.querySelector("svg");
        const addAccessibleName = add?.getAttribute("aria-label") || add?.getAttribute("title") || "";
        const projectHeader = panel?.querySelector(".orbit-project-header");
        const projectRoot = panel?.querySelector("[data-layer-tree-project-root]");
        const projectTitle = panel?.querySelector("[data-project-title]");
        const projectChevron = projectRoot?.querySelector(".layer-tree-chevron");
        const projectDivider = panel?.querySelector(".orbit-project-divider");
        const actions = [
            panel?.querySelector("#toggleAllVisibilityBtn"),
            panel?.querySelector("#removeAllLayersHeaderBtn")
        ];
        const bodies = panel?.querySelector("[data-layer-tree-bodies]");
        const bodiesHeader = bodies?.querySelector(".layer-tree-body-section-header");
        const earthRow = bodies?.querySelector("[data-layer-id='body:earth']");
        const earthItem = earthRow?.querySelector(".object-list-item");
        const earthIcon = earthRow?.querySelector(".layer-type-icon");

        // A fresh workspace only has the permanent Earth body, so it does not
        // naturally contain an input-format badge.  Mount one briefly using
        // the actual tree class so its typography remains covered without
        // making this visual test depend on a remote catalogue response.
        const badge = document.createElement("span");
        badge.className = "catalog-format-badge";
        badge.dataset.layersStyleProbe = "true";
        badge.textContent = "TLE";
        const badgeHost = earthRow?.querySelector(".object-list-item") || panel;
        badgeHost?.appendChild(badge);
        const badgePresentation = snapshot(badge);
        badge.remove();

        return {
            header: snapshot(header),
            heading: snapshot(heading),
            add: snapshot(add),
            addIcon: snapshot(addIcon),
            addAccessibleName,
            projectHeader: snapshot(projectHeader),
            projectRoot: snapshot(projectRoot),
            projectTitle: snapshot(projectTitle),
            projectTitleText: projectTitle?.textContent?.trim() || "",
            projectChevron: snapshot(projectChevron),
            projectDivider: snapshot(projectDivider),
            projectActions: actions.map(snapshot),
            bodiesHeader: snapshot(bodiesHeader),
            earthRow: snapshot(earthRow),
            earthItem: snapshot(earthItem),
            earthIcon: snapshot(earthIcon),
            badge: badgePresentation
        };
    });
}

function readRgbChannels(value) {
    const channels = String(value || "").match(/[\d.]+/g)?.map(Number) || [];
    return {
        red: channels[0] ?? 0,
        green: channels[1] ?? 0,
        blue: channels[2] ?? 0,
        alpha: channels[3] ?? 1
    };
}

function expectOrbitBlue(actual, label) {
    const color = readRgbChannels(actual);
    // #3a6ea8 is the supplied design token. Keep a small tolerance for an
    // rgba implementation while preserving the same quiet blue family.
    expect(color.red, `${label} must keep Orbit blue red channel`).toBeGreaterThanOrEqual(45);
    expect(color.red, `${label} must keep Orbit blue red channel`).toBeLessThanOrEqual(75);
    expect(color.green, `${label} must keep Orbit blue green channel`).toBeGreaterThanOrEqual(90);
    expect(color.green, `${label} must keep Orbit blue green channel`).toBeLessThanOrEqual(130);
    expect(color.blue, `${label} must keep Orbit blue blue channel`).toBeGreaterThanOrEqual(145);
    expect(color.blue, `${label} must keep Orbit blue blue channel`).toBeLessThanOrEqual(190);
}

/**
 * Read the visual contract shared by docked right-hand panels.  This is kept
 * geometry-based on purpose: right panels can be authored in React or in the
 * legacy workspace runtime, but they must still align with Layers and make
 * room for the simulation rail when it is visible.
 */
async function readDockedRightPanelLayout(page, panelSelector) {
    const layout = await page.evaluate((selector) => {
        const rect = (element) => {
            if (!(element instanceof HTMLElement)) return null;
            const styles = getComputedStyle(element);
            if (styles.display === "none" || styles.visibility === "hidden") return null;
            const bounds = element.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return null;
            return {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
                height: bounds.height
            };
        };

        return {
            panel: rect(document.querySelector(selector)),
            layers: rect(document.querySelector("#leftSatellitesPanel")),
            simulationDock: rect(document.querySelector(".react-simulation-dock")),
            viewport: { width: window.innerWidth, height: window.innerHeight }
        };
    }, panelSelector);

    expect(layout.panel, `${panelSelector} must be measurable`).not.toBeNull();
    expect(layout.layers, "Layers must be measurable while a docked panel is open").not.toBeNull();
    return layout;
}

function expectRightPanelToMatchLayers(layout, label, { minimumWidth = 0 } = {}) {
    const { panel, layers, viewport } = layout;
    expect(panel.left, `${label} must stay inside the viewport`).toBeGreaterThanOrEqual(-1);
    expect(panel.right, `${label} must stay inside the viewport`).toBeLessThanOrEqual(viewport.width + 1);
    expect(Math.abs(panel.top - layers.top), `${label} must share Layers' upper baseline`).toBeLessThanOrEqual(1);
    expect(Math.abs(panel.bottom - layers.bottom), `${label} must share Layers' lower baseline when the timeline is absent`).toBeLessThanOrEqual(1);
    if (minimumWidth > 0) {
        expect(panel.width, `${label} must retain the wider right-panel working width`).toBeGreaterThanOrEqual(minimumWidth);
    }
}

function expectRightPanelToClearSimulationDock(layout, label) {
    const { panel, simulationDock } = layout;
    expect(simulationDock, "Simulation dock must be measurable in simulated mode").not.toBeNull();
    expect(Math.abs(panel.top - layout.layers.top), `${label} must keep its upper baseline when the timeline opens`).toBeLessThanOrEqual(1);
    expect(panel.bottom, `${label} must end above the visible simulation dock`).toBeLessThanOrEqual(simulationDock.top - 8);
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
    const configLayout = await readDockedRightPanelLayout(page, "#configPanel");
    expectRightPanelToMatchLayers(configLayout, "Settings panel", { minimumWidth: 400 });
    await page.locator("#configPanel").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.locator("#configModal")).toHaveCount(0);

    // This is a separate React implementation from the station editor, but
    // its non-floating operational view must follow the same dock contract.
    await page.evaluate(() => window.dispatchEvent(new Event("orbit:ground-stations-open")));
    const groundOperations = page.getByLabel("Operaciones de estaciones terrestres", { exact: true });
    await expect(groundOperations).toBeVisible();
    await expectPanelSurfaceTransparency(page, '[aria-label="Operaciones de estaciones terrestres"]');
    const groundOperationsLayout = await readDockedRightPanelLayout(page, '[aria-label="Operaciones de estaciones terrestres"]');
    expectRightPanelToMatchLayers(groundOperationsLayout, "Ground stations operations panel", { minimumWidth: 400 });
    await page.evaluate(() => window.dispatchEvent(new Event("orbit:ground-stations-close")));
    await expect(groundOperations).toBeHidden();

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
    const objectDetailsLayout = await readDockedRightPanelLayout(page, ".object-details-panel");
    expectRightPanelToMatchLayers(objectDetailsLayout, "Object details panel", { minimumWidth: 400 });

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
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector(".object-details-panel");
        const dock = document.querySelector(".react-simulation-dock");
        if (!(panel instanceof HTMLElement) || !(dock instanceof HTMLElement)) return false;
        return panel.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top - 8;
    }), { message: "Object details must make room for the simulation rail" }).toBe(true);
    const simulatedObjectDetailsLayout = await readDockedRightPanelLayout(page, ".object-details-panel");
    expectRightPanelToClearSimulationDock(simulatedObjectDetailsLayout, "Object details panel");

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
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector(".object-details-panel");
        const layers = document.querySelector("#leftSatellitesPanel");
        if (!(panel instanceof HTMLElement) || !(layers instanceof HTMLElement)) return false;
        return Math.abs(panel.getBoundingClientRect().bottom - layers.getBoundingClientRect().bottom) <= 1;
    }), { message: "Object details must reclaim the lower workspace edge when the timeline is collapsed" }).toBe(true);
    const collapsedObjectDetailsLayout = await readDockedRightPanelLayout(page, ".object-details-panel");
    expectRightPanelToMatchLayers(collapsedObjectDetailsLayout, "Object details panel after collapsing the simulation rail", { minimumWidth: 400 });
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
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector(".object-details-panel");
        const dock = document.querySelector(".react-simulation-dock");
        if (!(panel instanceof HTMLElement) || !(dock instanceof HTMLElement)) return false;
        return panel.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top - 8;
    }), { message: "Object details must reserve the simulation rail again when it is restored" }).toBe(true);

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
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector(".object-details-panel");
        const layers = document.querySelector("#leftSatellitesPanel");
        if (!(panel instanceof HTMLElement) || !(layers instanceof HTMLElement)) return false;
        return Math.abs(panel.getBoundingClientRect().bottom - layers.getBoundingClientRect().bottom) <= 1;
    }), { message: "Object details must restore its full height after leaving simulated time" }).toBe(true);
    const restoredObjectDetailsLayout = await readDockedRightPanelLayout(page, ".object-details-panel");
    expectRightPanelToMatchLayers(restoredObjectDetailsLayout, "Object details panel in real time", { minimumWidth: 400 });

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

test("Rail, Layers y reloj comparten una carcasa lateral integrada", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);
    await page.evaluate(() => document.documentElement.style.setProperty("--orbit-ui-scale", "1"));

    await expect.poll(
        async () => {
            const layout = await readIntegratedLayersShell(page);
            return Boolean(
                layout.shell
                && layout.rail
                && layout.panel
                && layout.header
                && layout.heading
                && layout.search
                && layout.project
                && layout.tree
                && layout.footer
                && layout.footerContent
                && layout.footerMode
            );
        },
        { message: "The integrated Layers shell must settle before measuring its columns" }
    ).toBe(true);

    const shell = await readIntegratedLayersShell(page);
    const { shell: workspaceShell, rail, panel, header, heading, search, project, tree, footer, footerContent, footerMode, projectMenu } = shell;

    expect(workspaceShell, "The integrated workspace shell must be measurable").not.toBeNull();
    expect(rail, "The navigation rail must be measurable").not.toBeNull();
    expect(panel, "The Layers outer shell must be measurable").not.toBeNull();
    expect(header, "The Layers header must be measurable").not.toBeNull();
    expect(heading, "The Layers heading must be measurable").not.toBeNull();
    expect(search, "The Layers search row must be measurable").not.toBeNull();
    expect(project, "The project module must be measurable").not.toBeNull();
    expect(tree, "The Layers tree column must be measurable").not.toBeNull();
    expect(footer, "The project clock must be measurable").not.toBeNull();
    expect(footerContent, "The project clock's leading content must be measurable").not.toBeNull();
    expect(footerMode, "The project clock's trailing control must be measurable").not.toBeNull();

    // The wrapper owns the visual shell. The rail is its left column rather
    // than a separate floating card with a gap of globe before Layers.
    expect(Math.abs(workspaceShell.left - rail.left), "Rail must share the workspace shell's left edge").toBeLessThanOrEqual(1);
    expect(workspaceShell.left, "The workspace shell must retain the shared safe inset instead of clipping its rounded frame").toBeGreaterThanOrEqual(4);
    expect(Math.abs(workspaceShell.top - rail.top), "Rail must share the workspace shell's upper edge").toBeLessThanOrEqual(1);
    expect(Math.abs(workspaceShell.bottom - rail.bottom), "Rail must share the workspace shell's lower edge").toBeLessThanOrEqual(1);
    expect(Math.abs(workspaceShell.top - panel.top), "Layers must share the workspace shell's upper edge").toBeLessThanOrEqual(1);
    expect(Math.abs(workspaceShell.bottom - panel.bottom), "Layers must share the workspace shell's lower edge").toBeLessThanOrEqual(1);
    expect(Math.abs(workspaceShell.right - panel.right), "Layers must share the workspace shell's right edge").toBeLessThanOrEqual(1);
    expect(rail.right, "The rail must reserve a visible column inside the workspace shell").toBeGreaterThan(workspaceShell.left + 40);
    expect(rail.right, "The rail must end before the Layers content edge").toBeLessThan(workspaceShell.right - 120);

    // The rail and explorer can remain joined at their structural seam, but
    // they must still render distinct surfaces. The inner Layers gutter is
    // asserted below, rather than prescribing whether it comes from the
    // pane's own padding or a gap in the shared shell grid.
    const hasDistinctSurfaces = panel.backgroundImage !== rail.backgroundImage
        || panel.backgroundColor !== rail.backgroundColor;
    expect(hasDistinctSurfaces, "Rail and Layers must retain their own dark surfaces on either side of the divider").toBeTruthy();

    // The unified shell is the outer frame of both rail and Layers. Its cool
    // grey-blue technical line must be continuous around all four edges, not
    // only at the vertical divider. This makes every docked workspace panel
    // read as one intentional Orbit window.
    const outerFrameEdges = [
        { side: "top", width: workspaceShell.borderTopWidth, color: workspaceShell.borderTopColor },
        { side: "right", width: workspaceShell.borderRightWidth, color: workspaceShell.borderRightColor },
        { side: "bottom", width: workspaceShell.borderBottomWidth, color: workspaceShell.borderBottomColor },
        { side: "left", width: workspaceShell.borderLeftWidth, color: workspaceShell.borderLeftColor }
    ];
    for (const edge of outerFrameEdges) {
        expect(
            isVisibleTechnicalFrameEdge(edge.width, edge.color),
            `Integrated Layers shell must keep a visible cool grey-blue ${edge.side} frame edge`
        ).toBeTruthy();
    }
    const outerFrameWidths = outerFrameEdges.map((edge) => edge.width);
    expect(
        Math.max(...outerFrameWidths) - Math.min(...outerFrameWidths),
        "Technical frame thickness must remain consistent around the whole Layers window"
    ).toBeLessThanOrEqual(1);

    // A real divider is needed at the rail/content seam. It may be authored
    // as the rail's border or as a pseudo-element on either surface.
    const railDividerColor = readRgbChannels(rail.borderRightColor);
    const panelDividerColor = readRgbChannels(panel.borderLeftColor);
    const railBorderDivider = rail.borderRightWidth >= 1 && railDividerColor.alpha > .25;
    const panelBorderDivider = panel.borderLeftWidth >= 1 && panelDividerColor.alpha > .25;
    const pseudoDivider = [shell.shellAfter, shell.shellBefore, shell.railAfter, shell.railBefore, shell.panelAfter, shell.panelBefore]
        .some((candidate) => hasVisibleVerticalDivider(candidate, Math.max(rail.height, panel.height, workspaceShell.height) - 6));
    expect(railBorderDivider || panelBorderDivider || pseudoDivider, "Rail and Layers must expose a continuous vertical divider").toBeTruthy();
    if (railBorderDivider) {
        expect(railDividerColor.red, "Rail divider must use a neutral grey rather than an accent blue").toBeGreaterThanOrEqual(90);
        expect(railDividerColor.green, "Rail divider must use a neutral grey rather than an accent blue").toBeGreaterThanOrEqual(90);
    }

    // The Layers content itself needs a deliberate gutter beyond the rail
    // divider. This protects the title, controls and tree from visually
    // collapsing into the navigation rail while still keeping one joined
    // workspace shell.
    const contentItems = [heading, search, project, tree, footerContent];
    for (const item of contentItems) {
        expect(item.left, "Each Layers content region must start after a clear rail-to-content gutter").toBeGreaterThanOrEqual(rail.right + 6);
        expect(item.right, "Each Layers content region must stay inside the outer shell").toBeLessThanOrEqual(panel.right + 1);
    }
    expect(projectMenu, "Project header action must be measurable").not.toBeNull();
    expect(projectMenu.left, "Header controls must stay in the content column").toBeGreaterThanOrEqual(rail.right + 6);

    // The header's text and the footer use the same content gutter. A small
    // internal padding difference is permitted, but no second offset/card is.
    const contentLeft = Math.min(heading.left, search.left, project.left, footerContent.left);
    const contentRight = Math.max(search.right, project.right, footerMode.right);
    expect(Math.abs(search.left - footerContent.left), "Search and project clock content must share the left edge").toBeLessThanOrEqual(2);
    expect(Math.abs(search.right - footerMode.right), "Search and project clock content must share the right edge").toBeLessThanOrEqual(2);
    expect(heading.left, "Header title must not be placed under the rail").toBeGreaterThanOrEqual(contentLeft - 1);
    expect(heading.left - contentLeft, "Header title must use the same content gutter").toBeLessThanOrEqual(24);
    expect(contentRight, "Content column must retain a practical width").toBeGreaterThan(contentLeft + 180);

    // The integrated footer stays below the explorer flow. It cannot cover
    // the header/search/project controls or allow the tree to pass through it.
    expect(footer.top, "Footer must start below the Layers header").toBeGreaterThanOrEqual(header.bottom - 1);
    expect(footer.top, "Footer must start below the search row").toBeGreaterThanOrEqual(search.bottom - 1);
    expect(footer.top, "Footer must start below the project root").toBeGreaterThanOrEqual(project.bottom - 1);
    expect(tree.bottom, "Tree must stop before the integrated footer").toBeLessThanOrEqual(footer.top + 1);
    expect(rectanglesOverlap(footer, search), "Footer and search must not overlap").toBeFalsy();
    expect(rectanglesOverlap(footer, project), "Footer and project module must not overlap").toBeFalsy();
    expect(rectanglesOverlap(footer, tree), "Footer and Layers tree must not overlap").toBeFalsy();

    // Collapsing Layers must not remove the compact navigator's right-hand
    // frame. In this state the outer shell owns that edge, so it remains the
    // same quiet 1 px line as the top, left and bottom edges.
    await page.locator("#leftSatellitesBtn").click();
    await expect(page.locator("#leftWorkspaceShell")).toHaveClass(/is-layers-closed/);
    const collapsedShellFrame = await page.evaluate(() => {
        const shell = document.querySelector("#leftWorkspaceShell");
        if (!(shell instanceof HTMLElement)) return null;
        const style = getComputedStyle(shell);
        return {
            width: Number.parseFloat(style.borderRightWidth),
            color: style.borderRightColor
        };
    });
    expect(collapsedShellFrame, "Collapsed shell must keep a measurable right frame").not.toBeNull();
    expect(
        isVisibleTechnicalFrameEdge(collapsedShellFrame.width, collapsedShellFrame.color),
        "Collapsed rail must keep the same visible cool grey-blue outer edge"
    ).toBeTruthy();
    expect(collapsedShellFrame.width, "Collapsed rail edge must match the 1 px outer frame").toBeCloseTo(1, 0);
});

test("El chrome principal normaliza bordes, tipografia y esquinas", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);
    await page.evaluate(() => document.documentElement.style.setProperty("--orbit-ui-scale", "1"));

    const layersShell = await readPrimaryChromeSurface(page, "#leftWorkspaceShell", "top");
    const toolbar = await readPrimaryChromeSurface(page, "#topToolbar", "bottom");

    // Settings is the canonical right-side dock. Capture it while it is open
    // so this contract covers a panel that does not share the Layers DOM.
    await page.locator("#topSettingsBtn").click();
    await expect(page.locator("#configPanel")).toBeVisible();
    const settings = await readPrimaryChromeSurface(page, "#configPanel", "top");
    await page.locator("#configPanel").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.locator("#configPanel")).toHaveCount(0);

    // The simulation rail is the persistent lower dock. It must not regress
    // to a second visual language when the simulated timeline is enabled.
    await page.locator("#projectTimeModeBtn").click();
    await page.getByRole("menuitemradio", { name: "Simulated", exact: true }).click();
    await expect(page.locator(".react-simulation-dock")).toBeVisible();
    const timeline = await readPrimaryChromeSurface(page, ".react-simulation-dock", "top");

    expect(layersShell.borderWidth, "The Layers workspace must expose a tangible technical frame").toBeCloseTo(1, 3);
    expect(layersShell.fontFamily, "The primary application chrome must use Inter").toMatch(/inter/i);

    // The full-width toolbar has one structural edge, whereas the docks have
    // complete frames. All of those visible edges must resolve to the same
    // token rather than slightly different legacy greys or blue tints.
    expectSharedPrimaryChrome(layersShell, layersShell, "Layers workspace");
    expectSharedPrimaryChrome(layersShell, toolbar, "Top toolbar");
    expectSharedPrimaryChrome(layersShell, settings, "Settings dock");
    expectSharedPrimaryChrome(layersShell, timeline, "Simulation dock");
});

test("La barra lateral presenta iconos y etiquetas como bloques de navegación", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    // The rail dimensions are specified in CSS pixels. Pin the configurable
    // UI scale so a browser/device scale cannot hide a regression in the
    // 26 / 10 / 6 / 52 composition itself.
    await page.evaluate(() => document.documentElement.style.setProperty("--orbit-ui-scale", "1"));

    const initial = await readSidebarNavigationBlocks(page);
    expect(initial, "The workspace navigation rail must exist").not.toBeNull();
    expect(initial.blocks.length, "The rail must expose navigable blocks").toBeGreaterThanOrEqual(4);
    expect(initial.blocks.filter((block) => !block.active).length, "The fresh rail must expose neutral navigation entries").toBeGreaterThanOrEqual(3);
    expect(initial.rowGap, "Labelled rail blocks need a deliberate breathing band").toBeGreaterThanOrEqual(10);

    for (const block of initial.blocks) {
        expect(block.button, `${block.id} must keep a measurable navigation block`).not.toBeNull();
        expect(block.icon, `${block.id} must expose a visible icon`).not.toBeNull();
        expect(block.label, `${block.id} must expose its visible label`).not.toBeNull();
        expect(block.labelText, `${block.id} label must not be empty`).not.toBe("");
        expect(block.labelTextTransform, `${block.id} label must retain its authored title case`).toBe("none");
        expect(block.labelText, `${block.id} label must start with an uppercase letter`).toMatch(/^\p{Lu}/u);
        expect(block.labelText, `${block.id} label must not be forced to all caps`).not.toBe(block.labelText.toUpperCase());

        expect(block.button.height, `${block.id} must use the 52px rail block`).toBeCloseTo(52, 0);
        expect(block.icon.width, `${block.id} icon must use the 26px visual size`).toBeCloseTo(26, 0);
        expect(block.icon.height, `${block.id} icon must use the 26px visual size`).toBeCloseTo(26, 0);
        expect(block.label.height, `${block.id} label must remain compact`).toBeGreaterThanOrEqual(9);
        expect(block.label.height, `${block.id} label must remain compact`).toBeLessThanOrEqual(12);

        const iconToLabelGap = block.label.top - block.icon.bottom;
        expect(iconToLabelGap, `${block.id} must leave a 6px icon/label gap`).toBeCloseTo(6, 0);
        expect(Math.abs(block.icon.centerX - block.button.centerX), `${block.id} icon must be centred in its block`).toBeLessThanOrEqual(1);
        expect(Math.abs(block.label.centerX - block.button.centerX), `${block.id} label must be centred in its block`).toBeLessThanOrEqual(1);

        // The active route intentionally retains its navigation accent. The
        // neutral rail entries are the ones that define the resting text
        // token requested for this redesign.
        if (!block.active && !block.disabled) {
            expectOrbitSidebarColor(block.labelColor, { red: 185, green: 201, blue: 223 }, `${block.id} resting label`);
            const effectiveLabelAlpha = block.labelColor.alpha * block.labelColor.opacity;
            expect(effectiveLabelAlpha, `${block.id} resting label must keep its 75% visual opacity`).toBeCloseTo(0.75, 2);
        }
    }

    const layersBlock = initial.blocks.find((block) => block.id === "leftSatellitesBtn");
    const manualOrbitBlock = initial.blocks.find((block) => block.id === "leftManualOrbitBtn");
    expect(layersBlock, "The Layers rail block must be present").toBeDefined();
    expect(manualOrbitBlock, "The manual-orbit rail block must be present").toBeDefined();
    expect(layersBlock.labelText, "The Layers rail label must use title case").toBe("Layers");
    expect(layersBlock.separator.content, "Layers must expose its separator rule").not.toBe("none");
    expect(layersBlock.separator.display, "Layers separator must remain visible").not.toBe("none");
    expect(layersBlock.separator.height, "Layers separator must stay thin").toBeGreaterThan(0);
    expect(layersBlock.separator.backgroundImage, "Layers separator must use the subtle rail gradient").toMatch(/gradient/i);
    expect(layersBlock.separator.bottom, "Layers separator must sit in the breathing band below its label").toBeLessThan(0);
    expect(manualOrbitBlock.button.top - layersBlock.button.bottom, "The separator must have air on both sides").toBeGreaterThanOrEqual(10);

    // Layers starts active in a fresh workspace, so exercise an inactive
    // sibling. Hover must brighten both parts of the navigation item, not
    // only the icon or its background.
    const hoverTarget = page.locator("#leftManualOrbitBtn");
    await expect(hoverTarget).toBeVisible();
    await hoverTarget.hover();
    const hovered = await readSidebarNavigationBlocks(page);
    const hoveredBlock = hovered.blocks.find((block) => block.id === "leftManualOrbitBtn");
    expect(hoveredBlock, "The manual-orbit rail block must still be present after hover").toBeDefined();
    expectOrbitSidebarColor(hoveredBlock.iconColor, { red: 237, green: 244, blue: 255 }, "Hovered icon");
    expectOrbitSidebarColor(hoveredBlock.labelColor, { red: 237, green: 244, blue: 255 }, "Hovered label");
    expect(hoveredBlock.labelColor.alpha * hoveredBlock.labelColor.opacity, "Hovered label must become fully legible").toBeGreaterThanOrEqual(0.99);
});

test("Layers mantiene un explorador técnico compacto y jerárquico", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);
    await page.evaluate(() => document.documentElement.style.setProperty("--orbit-ui-scale", "1"));

    // A new workspace only creates the permanent Earth body, so the real
    // mission actions are correctly hidden. Reveal their existing controls
    // only for this visual measurement; their show/hide state is covered by
    // the project-action tests and must not depend on a remote TLE catalogue.
    // A CSS probe survives the regular React clock re-render that would reset
    // a temporary `hidden = false` DOM mutation.
    await page.addStyleTag({ content: "#leftSatellitesPanel #toggleAllVisibilityBtn[hidden], #leftSatellitesPanel #removeAllLayersHeaderBtn[hidden] { display: grid !important; }" });
    const eyeAction = page.locator("#toggleAllVisibilityBtn");
    const removeAction = page.locator("#removeAllLayersHeaderBtn");
    await expect(eyeAction).toBeVisible();
    await expect(removeAction).toBeVisible();
    await expect(eyeAction).toHaveClass(/orbit-project-action/);
    await expect(removeAction).toHaveClass(/orbit-project-action/);
    await expect(page.locator("#openCatalogBtn")).toHaveClass(/orbit-layers-header-add/);

    const earth = page.locator("#leftSatellitesPanel [data-layer-id='body:earth']");
    await expect(page.locator("#leftSatellitesPanel [data-layer-tree-bodies]")).toBeVisible();
    await expect(earth).toBeVisible();

    const resting = await readLayersExplorerPresentation(page);
    expect(resting.header, "Layers header must be rendered").not.toBeNull();
    expect(resting.heading, "Layers heading must be rendered").not.toBeNull();
    expect(await page.locator("#leftSatellitesPanel .orbit-layers-heading").textContent(), "Layers panel heading must use title case").toBe("Layers");
    expect(resting.add, "Layers add action must be rendered").not.toBeNull();
    expect(resting.addIcon, "Layers add action must expose a plus icon").not.toBeNull();
    expect(resting.addAccessibleName, "Icon-only Layers add action must expose its accessible name").toContain("Añadir");
    expect(resting.projectHeader, "Project module header must be rendered").not.toBeNull();
    expect(resting.projectRoot, "Project root control must be rendered").not.toBeNull();
    expect(resting.projectTitle, "Project title must be rendered").not.toBeNull();
    expect(resting.projectChevron, "Project root must retain its collapse chevron").not.toBeNull();
    expect(resting.projectDivider, "Project module must expose its own separator").not.toBeNull();
    expect(resting.bodiesHeader, "Bodies module header must be rendered").not.toBeNull();
    expect(resting.earthRow, "Earth must be rendered inside Bodies").not.toBeNull();
    expect(resting.earthIcon, "Earth must retain a visible type icon").not.toBeNull();
    expect(resting.badge, "Input-format badges must retain a style contract").not.toBeNull();

    // Header typography and the slim divider make the explorer read as a
    // stable module rather than a generic browser sidebar.
    expect(resting.heading.fontFamily, "Layers title must use Inter").toMatch(/inter/i);
    expect(resting.heading.fontSize, "Layers title must use the 14–15px hierarchy").toBeGreaterThanOrEqual(14);
    expect(resting.heading.fontSize, "Layers title must use the 14–15px hierarchy").toBeLessThanOrEqual(15);
    expect(resting.heading.fontWeight, "Layers title must be semibold or stronger").toBeGreaterThanOrEqual(600);
    expect(resting.header.borderBottomStyle, "Layers header must have a separator").not.toBe("none");
    expect(resting.header.borderBottomWidth, "Layers separator must stay visually thin").toBeCloseTo(1, 0);

    // The add action lives in the header as an icon-only tool: compact and
    // fully labelled for assistive technologies.
    expect(resting.add.height, "Add-layer tool must use a compact header target").toBeGreaterThanOrEqual(24);
    expect(resting.add.height, "Add-layer tool must use a compact header target").toBeLessThanOrEqual(36);
    expect(resting.addIcon.width, "The plus icon must remain visually legible").toBeGreaterThanOrEqual(12);
    expect(resting.addIcon.height, "The plus icon must remain visually legible").toBeGreaterThanOrEqual(12);
    expect(resting.add.fontFamily, "Add-layer tool must use the shared Inter UI font").toMatch(/inter/i);

    expect(resting.projectTitle.fontFamily, "Project module title must use Inter").toMatch(/inter/i);
    expect(resting.projectTitleText, "Project title must retain the technical uppercase treatment").toBe(resting.projectTitleText.toUpperCase());
    // A project is the workspace identity, not a folder in the layer tree.
    // It keeps only the chevron required to collapse its contents: no folder
    // glyph may be inserted between the control and its title.
    await expect(page.locator("[data-layer-tree-project-root] .layer-tree-icon")).toHaveCount(0);
    await expect(page.locator("[data-layer-tree-project-root] .layer-tree-chevron svg")).toHaveCount(1);
    expect(resting.projectDivider.height, "Project separator must read as a marked module boundary").toBeGreaterThanOrEqual(2);
    expect(resting.projectDivider.width, "Project separator must span the project module").toBeGreaterThanOrEqual(resting.projectHeader.width - 2);
    expect(resting.projectDivider.top, "Project separator must sit below the project title").toBeGreaterThan(resting.projectRoot.bottom);
    const projectActions = resting.projectActions.filter(Boolean);
    expect(projectActions, "Project eye and delete actions must be measurable").toHaveLength(2);
    for (const action of projectActions) {
        expect(action.width, "Project actions must use 24px circular targets").toBeCloseTo(24, 0);
        expect(action.height, "Project actions must use 24px circular targets").toBeCloseTo(24, 0);
        expect(action.borderRadius, "Project actions must be circular").toBeGreaterThanOrEqual(11);
        expect(action.right, "Project actions must stay inside their module header").toBeLessThanOrEqual(resting.projectHeader.right + 1);
    }
    expect(projectActions[0].left, "Project actions must sit to the right of the project module").toBeGreaterThan(resting.projectHeader.left + (resting.projectHeader.width * 0.45));

    // Bodies is a distinct child branch. Earth must visibly step in from its
    // section header and preserve a type-specific icon instead of becoming a
    // flat list item.
    expect(resting.earthRow.left, "Earth must be indented beneath Bodies").toBeGreaterThanOrEqual(resting.bodiesHeader.left + 12);
    expect(resting.earthIcon.width, "Earth type icon must remain visible").toBeGreaterThanOrEqual(12);
    expect(resting.earthIcon.height, "Earth type icon must remain visible").toBeGreaterThanOrEqual(12);
    expect(resting.badge.fontFamily, "Layer tags must use Inter").toMatch(/inter/i);
    expect(resting.badge.fontSize, "Layer tags must use the compact 9px density").toBeCloseTo(9, 0);

    await earth.hover();
    const earthHovered = await readLayersExplorerPresentation(page);
    const rowHoverChanged = earthHovered.earthRow.backgroundColor !== resting.earthRow.backgroundColor
        || earthHovered.earthRow.backgroundImage !== resting.earthRow.backgroundImage
        || earthHovered.earthRow.borderTopColor !== resting.earthRow.borderTopColor
        || earthHovered.earthRow.boxShadow !== resting.earthRow.boxShadow
        || earthHovered.earthItem?.backgroundColor !== resting.earthItem?.backgroundColor
        || earthHovered.earthItem?.backgroundImage !== resting.earthItem?.backgroundImage
        || earthHovered.earthItem?.borderTopColor !== resting.earthItem?.borderTopColor
        || earthHovered.earthItem?.boxShadow !== resting.earthItem?.boxShadow;
    expect(rowHoverChanged, "Layer rows must expose a subtle hover state").toBeTruthy();
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

test("Crear una estaci\u00f3n desde Layers confirma la transici\u00f3n al dise\u00f1ador", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);

    await chooseLayerKind(page, "station");
    const confirmation = page.locator("#sidebarConfirmModal");
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("heading", { name: "Crear estaci\u00f3n terrestre manual", exact: true })).toBeVisible();
    await expect(confirmation.getByText(/continuar\u00e1n en segundo plano/i)).toBeVisible();
    await expect(page.locator("#groundStationModal")).not.toHaveClass(/open/);

    await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.locator("#groundStationModal")).not.toHaveClass(/open/);
    await expect(page.locator("#leftSatellitesPanel")).toHaveClass(/open/);

    await chooseLayerKind(page, "station");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Continuar al dise\u00f1o", exact: true }).click();
    await expect(page.locator("#groundStationModal")).toHaveClass(/open/);
    await expect(page.locator("#leftSatellitesPanel")).not.toHaveClass(/open/);
    await expect(page.locator("#leftSatellitesPanel")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#leftSatellitesBtn")).not.toHaveClass(/active/);
    await expect(page.locator("#leftSatellitesBtn")).toHaveAttribute("aria-expanded", "false");

    await page.locator("#groundStationCloseBtn").click();
    await expect(confirmation).toBeVisible();
    await confirmation.locator("button").last().click();
    await expect(page.locator("#groundStationModal")).not.toHaveClass(/open/);
    await expect(page.locator("#leftSatellitesPanel")).toHaveClass(/open/);
    await expect(page.locator("#leftSatellitesPanel")).toHaveAttribute("aria-hidden", "false");
});

test("El editor de estaciones de tierra mantiene sus formularios accesibles", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openWorkspace(page);
    await ensureLayersPanelOpen(page);
    await chooseLayerKind(page, "station");
    const confirmation = page.locator("#sidebarConfirmModal");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Continuar al dise\u00f1o", exact: true }).click();

    await expect(page.locator("#groundStationModal")).toHaveCount(1);
    await expect(page.locator("#groundStationModal")).toHaveClass(/open/);
    const groundStationPanel = page.locator("#groundStationModal .ground-station-panel");
    await expect(groundStationPanel).toHaveAttribute("role", "dialog");
    await expect(groundStationPanel.getByRole("heading", { name: "Nueva estación terrestre", exact: true })).toBeVisible();
    await expect(groundStationPanel.getByText("DISEÑO DE ESTACIÓN", { exact: true })).toBeVisible();
    await expect(groundStationPanel.getByRole("button", { name: "Cerrar creador de estación terrestre", exact: true })).toBeVisible();
    await expect(page.locator("#leftSatellitesPanel")).toBeVisible();
    await expectPanelInsideViewport(page, "#groundStationModal .ground-station-panel");
    await expectPanelSurfaceTransparency(page, "#groundStationModal .ground-station-panel");

    // The station designer is a docked right-hand workspace, not a smaller
    // floating form. In the normal timeline modes it must use the same full
    // vertical working area as Layers.
    const initialStationLayout = await readDockedRightPanelLayout(page, "#groundStationModal .ground-station-panel");
    expectRightPanelToMatchLayers(initialStationLayout, "Ground station designer", { minimumWidth: 400 });

    const hasHorizontalOverflow = async () => groundStationPanel.evaluate((panel) => panel.scrollWidth > panel.clientWidth + 1);
    expect(await hasHorizontalOverflow(), "Ground station form must not create horizontal scrolling").toBeFalsy();

    const tabs = groundStationPanel.getByRole("tab");
    await expect(tabs).toHaveCount(5);
    await expect(groundStationPanel.getByRole("tab", { name: "GENERAL", exact: true })).toHaveAttribute("aria-selected", "true");

    for (const [tab, fieldSelector] of [["ANTENA", 'input[type="number"]'], ["RADIO", 'input[type="number"]'], ["APUNTADO", "select"], ["VISUAL", 'input[type="color"]']]) {
        const tabButton = groundStationPanel.getByRole("tab", { name: tab, exact: true });
        await tabButton.click();
        await expect(tabButton).toHaveClass(/active/);
        await expect(tabButton).toHaveAttribute("aria-selected", "true");
        const panelId = await tabButton.getAttribute("aria-controls");
        expect(panelId, `${tab} must control a tab panel`).toBeTruthy();
        const activeTabPanel = groundStationPanel.locator(`#${panelId}`);
        await expect(activeTabPanel).toHaveAttribute("role", "tabpanel");
        await expect(activeTabPanel).toBeVisible();
        const firstControl = activeTabPanel.locator(fieldSelector).first();
        const lastControl = activeTabPanel.locator("input, select").last();
        await firstControl.scrollIntoViewIfNeeded();
        await expect(firstControl).toBeVisible();
        await expect(firstControl).toBeInViewport();
        await lastControl.scrollIntoViewIfNeeded();
        await expect(lastControl).toBeVisible();
        await expect(lastControl).toBeInViewport();
        expect(await hasHorizontalOverflow(), "Ground station form must not create horizontal scrolling").toBeFalsy();
    }

    const coverageToggle = groundStationPanel.locator('#gsCoverageVisibleInput');
    await expect(coverageToggle).toBeVisible();
    const coverageToggleSize = await coverageToggle.evaluate((input) => {
        const rect = input.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    expect(coverageToggleSize.width, "Coverage visibility checkbox must use the compact station-designer scale").toBe(18);
    expect(coverageToggleSize.height, "Coverage visibility checkbox must use the compact station-designer scale").toBe(18);
    const stationDesignBadgeStyle = await groundStationPanel.locator(".ground-station-design-badge").evaluate((badge) => {
        const style = window.getComputedStyle(badge);
        return {
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            borderRadius: style.borderRadius,
            color: style.color,
            fontSize: style.fontSize,
            letterSpacing: style.letterSpacing,
        };
    });
    expect(stationDesignBadgeStyle.backgroundColor, "Station design badge must share the Manual Orbit mode background").toBe("rgb(16, 39, 71)");
    expect(stationDesignBadgeStyle.borderColor, "Station design badge must share the Manual Orbit mode border").toBe("rgb(53, 109, 194)");
    expect(stationDesignBadgeStyle.color, "Station design badge must share the Manual Orbit mode text color").toBe("rgb(183, 212, 255)");
    expect(stationDesignBadgeStyle.fontSize, "Station design badge must share the Manual Orbit mode type scale").toBe("8px");
    expect(stationDesignBadgeStyle.letterSpacing, "Station design badge must share the Manual Orbit mode tracking").toBe("0.72px");
    expect(stationDesignBadgeStyle.borderRadius, "Station design badge must keep the Manual Orbit pill silhouette").toBe("999px");
    await expect(groundStationPanel.getByRole("button", { name: "Heat map", exact: true })).toHaveCount(0);
    await expect(page.locator("#groundStationHeatLegend")).toHaveCount(0);

    // A visible simulation rail consumes the lower workspace edge. The
    // designer must shrink above it, then reclaim the Layer height when the
    // rail is collapsed or when the timeline returns to real time.
    const timeModeButton = page.locator("#projectTimeModeBtn");
    await timeModeButton.click();
    await page.getByRole("menuitemradio", { name: "Simulated", exact: true }).click();
    const simulationDock = page.locator(".react-simulation-dock");
    await expect(simulationDock).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector("#groundStationModal .ground-station-panel");
        const dock = document.querySelector(".react-simulation-dock");
        if (!(panel instanceof HTMLElement) || !(dock instanceof HTMLElement)) return false;
        return panel.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top - 8;
    }), { message: "Ground station designer must make room for the simulation rail" }).toBe(true);
    const simulatedStationLayout = await readDockedRightPanelLayout(page, "#groundStationModal .ground-station-panel");
    expectRightPanelToClearSimulationDock(simulatedStationLayout, "Ground station designer");
    expect(simulatedStationLayout.panel.height, "Ground station designer must become shorter while the simulation rail is open").toBeLessThan(initialStationLayout.panel.height - 20);

    const hideSimulationDock = page.getByRole("button", { name: "Ocultar control de simulacion", exact: true });
    await hideSimulationDock.click();
    await expect(page.getByRole("button", { name: "Mostrar control de simulacion", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector("#groundStationModal .ground-station-panel");
        const layers = document.querySelector("#leftSatellitesPanel");
        if (!(panel instanceof HTMLElement) || !(layers instanceof HTMLElement)) return false;
        return Math.abs(panel.getBoundingClientRect().bottom - layers.getBoundingClientRect().bottom) <= 1;
    }), { message: "Ground station designer must reclaim its full height when the simulation rail is collapsed" }).toBe(true);
    const collapsedStationLayout = await readDockedRightPanelLayout(page, "#groundStationModal .ground-station-panel");
    expectRightPanelToMatchLayers(collapsedStationLayout, "Ground station designer after collapsing the simulation rail", { minimumWidth: 400 });

    await timeModeButton.click();
    await page.getByRole("menuitemradio", { name: "Real time", exact: true }).click();
    await expect(simulationDock).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector("#groundStationModal .ground-station-panel");
        const layers = document.querySelector("#leftSatellitesPanel");
        if (!(panel instanceof HTMLElement) || !(layers instanceof HTMLElement)) return false;
        return Math.abs(panel.getBoundingClientRect().bottom - layers.getBoundingClientRect().bottom) <= 1;
    }), { message: "Ground station designer must restore its normal height in real time" }).toBe(true);
    const restoredStationLayout = await readDockedRightPanelLayout(page, "#groundStationModal .ground-station-panel");
    expectRightPanelToMatchLayers(restoredStationLayout, "Ground station designer in real time", { minimumWidth: 400 });
});

test("La bienvenida crea un proyecto y entrega el control al visor", async ({ page }) => {
    const projectName = "UI regression project";
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await createLocalIdentityThroughUi(page);
    await waitForOrbitRuntimeReady(page);
    await createProjectThroughHub(page, projectName);

    await expect(page.locator("#projectWelcome")).toBeHidden();
    await expect(page.locator("#projectActionModal")).toHaveCount(0);
    await expect(page.locator("[data-project-title]").first()).toHaveText(new RegExp(`^${projectName}$`, "i"));
});

test("La bienvenida queda centrada y Generate orbit abre el diseñador con sus vectores", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await createLocalIdentityThroughUi(page);
    await waitForOrbitRuntimeReady(page);
    await waitForAuthenticatedProjectHub(page);

    const welcomeCenter = await page.locator("#projectWelcome > div").last().evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2), width: window.innerWidth, height: window.innerHeight };
    });
    expect(Math.abs(welcomeCenter.x - (welcomeCenter.width / 2)), "Welcome dialog must be horizontally centred").toBeLessThanOrEqual(2);
    expect(Math.abs(welcomeCenter.y - (welcomeCenter.height / 2)), "Welcome dialog must be vertically centred").toBeLessThanOrEqual(2);

    await createProjectThroughHub(page, `Responsive workspace ${++workspaceSequence}`);
    await ensureLayersPanelOpen(page);
    const layerWorkspaceBaseline = await page.locator("#leftSatellitesPanel").evaluate((panel) => {
        const rect = panel.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
    });
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
    const manualOrbitGeometry = await designer.evaluate((panel) => {
        const rect = panel.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: rect.width, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(Math.abs(manualOrbitGeometry.top - layerWorkspaceBaseline.top), "Manual orbit must share the Layers upper baseline").toBeLessThanOrEqual(1);
    expect(Math.abs(manualOrbitGeometry.bottom - layerWorkspaceBaseline.bottom), "Manual orbit must share the Layers lower baseline").toBeLessThanOrEqual(1);
    expect(manualOrbitGeometry.width, "Manual orbit must retain the shared wide right-panel width").toBeGreaterThanOrEqual(400);
    expect(manualOrbitGeometry.right, "Manual orbit must remain inside the viewport").toBeLessThanOrEqual(manualOrbitGeometry.viewportWidth + 1);
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
    await createLocalIdentityThroughUi(page);
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
    await createLocalIdentityThroughUi(page);
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

test("La biblioteca autenticada espera a que el arbol de capas este listo antes de crear un proyecto", async ({ page }) => {
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

        await createLocalIdentityThroughUi(page);
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

        // The authenticated hub intentionally does not queue a project
        // creation against a partially initialised scene. It becomes usable
        // only after this same renderer/catalogue readiness transition.
        await expect(welcome).toBeVisible();

        releaseCatalog();
        await waitForOrbitRuntimeReady(page);
        await createProjectThroughHub(page, "Queued workspace");
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

    await createLocalIdentityThroughUi(page);
    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect.poll(
        () => page.evaluate(() => window.__orbitRuntimeStatus?.state || "loading"),
        { timeout: 30_000, message: "A failed renderer must be reported after local authentication" }
    ).toBe("failed");
    const hub = welcome.getByTestId("authenticated-project-hub");
    await expect(hub).toBeVisible({ timeout: 30_000 });
    await expect(hub.getByText("El visor no se pudo iniciar.", { exact: false })).toBeVisible();
    await expect(hub.getByRole("button", { name: "Crear proyecto", exact: true })).toBeDisabled();
    await expect(hub.getByRole("button", { name: "Generar desde cero", exact: true })).toBeDisabled();
    await expect(page.locator("#projectActionModal")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__orbitPendingProjectCommands || [])).toEqual([]);
});

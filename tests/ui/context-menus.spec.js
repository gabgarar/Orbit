import { expect, test } from "@playwright/test";
import { openWorkspaceThroughLocalIdentity } from "./helpers/identity-workspace.js";

test.beforeEach(async ({ page }) => {
    // These contracts exercise the React overlays rather than Cesium imagery.
    // Keeping visual assets out of the page makes the checks deterministic.
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

async function openWorkspace(page, projectName = "Context menu project") {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openWorkspaceThroughLocalIdentity(page, projectName);
    await expect(page.locator("#leftSatellitesPanel")).toHaveClass(/open/);
}

async function expectUnifiedContextMenu(menu, { title, actions }) {
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("role", "menu");
    await expect(menu).toHaveAttribute("aria-label", /.+/);

    const header = menu.locator("[data-context-menu-header]");
    await expect(header).toBeVisible();
    await expect(header.locator("[data-context-menu-icon]")).toBeVisible();
    await expect(header.locator("[data-context-menu-title]")).toContainText(title);

    for (const { label } of actions) {
        const item = menu.getByRole("menuitem", { name: label });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute("role", "menuitem");
        await expect(item.locator("[data-context-menu-action-title]")).toHaveText(label);
        const description = item.locator("[data-context-menu-action-description]");
        await expect(description).toBeVisible();
        expect((await description.textContent())?.trim(), `${String(label)} must explain its effect`).not.toBe("");
    }

    // Every action in a contextual menu follows the same two-line treatment,
    // including actions that are not relevant to this individual test case.
    const menuItems = menu.getByRole("menuitem");
    const count = await menuItems.count();
    expect(count, "A contextual menu must expose at least one action").toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
        const item = menuItems.nth(index);
        await expect(item.locator("[data-context-menu-action-title]")).toBeVisible();
        const description = item.locator("[data-context-menu-action-description]");
        await expect(description).toBeVisible();
        expect((await description.textContent())?.trim(), `Context action ${index + 1} must have a description`).not.toBe("");
    }
}

test("project, satellite and ground-station contextual menus share an identified, descriptive layout", async ({ page }) => {
    await openWorkspace(page);

    await test.step("project menu uses the project identity and descriptive actions", async () => {
        const projectRoot = page.locator("[data-layer-tree-project-root]");
        await projectRoot.click({ button: "right" });

        await expectUnifiedContextMenu(page.locator("#projectActionsMenu"), {
            title: /Context menu project/i,
            actions: [
                { label: "Nuevo proyecto" },
                { label: "Importar proyecto" },
                { label: "Guardar proyecto" },
                { label: "Exportar proyecto" }
            ]
        });

        await page.keyboard.press("Escape");
        await expect(page.locator("#projectActionsMenu")).toBeHidden();
    });

    await test.step("satellite menu identifies the selected layer instead of a generic project", async () => {
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("orbit:satellite-context-open", {
                detail: {
                    id: "satellite:ORBIT-TEST",
                    sourceId: "satellite:ORBIT-TEST",
                    name: "ORBIT-TEST",
                    layerType: "SATELLITE",
                    left: 64,
                    top: 96
                }
            }));
        });

        await expectUnifiedContextMenu(page.locator("#satelliteContextMenu"), {
            title: "ORBIT-TEST",
            actions: [
                { label: "Centrar vista" },
                { label: "Opciones de visualización" },
                { label: "Efemérides" }
            ]
        });

        await page.evaluate(() => window.dispatchEvent(new Event("orbit:satellite-context-close")));
        await expect(page.locator("#satelliteContextMenu")).toBeHidden();
    });

    await test.step("ground-station menu identifies the station and documents station actions", async () => {
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("orbit:layer-context-menu", {
                detail: {
                    id: "ground-station:madrid",
                    name: "Est. Madrid",
                    left: 64,
                    top: 96,
                    layerType: "GROUND_STATION",
                    groundStation: true,
                    visible: true
                }
            }));
        });

        await expectUnifiedContextMenu(page.locator("#catalogContextMenu"), {
            title: "Est. Madrid",
            actions: [
                { label: "Centrar vista" },
                { label: "Ocultar capa" },
                { label: "Actualizar parámetros" },
                { label: /Exportar/ },
                { label: "Eliminar capa" }
            ]
        });

        await page.evaluate(() => window.dispatchEvent(new Event("orbit:layer-context-menu-close")));
        await expect(page.locator("#catalogContextMenu")).toBeHidden();
    });

    await test.step("folder menus retain the same treatment through nested actions", async () => {
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent("orbit:tree-context-menu", {
                detail: {
                    kind: "folder",
                    folderId: "folder:mission",
                    title: "Mission group",
                    left: 64,
                    top: 96
                }
            }));
        });

        const folderMenu = page.locator("#treeContextMenu");
        await expectUnifiedContextMenu(folderMenu, {
            title: "Mission group",
            actions: [
                { label: "Mostrar todas las capas" },
                { label: "Ocultar todas las capas" },
                { label: "Añadir capa" },
                { label: "Nueva subcarpeta" },
                { label: "Eliminar carpeta" }
            ]
        });

        await folderMenu.getByRole("menuitem", { name: "Añadir capa" }).click();
        await expectUnifiedContextMenu(page.locator("#treeContextAddMenu"), {
            title: "Añadir capa",
            actions: [
                { label: "Añadir satélite" },
                { label: "Estación de tierra" }
            ]
        });

        await page.evaluate(() => window.dispatchEvent(new Event("orbit:tree-context-menu-close")));
        await expect(folderMenu).toBeHidden();
        await expect(page.locator("#treeContextAddMenu")).toBeHidden();
    });
});

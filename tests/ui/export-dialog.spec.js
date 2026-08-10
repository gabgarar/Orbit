import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    // The export UI is independent from texture and font delivery. Blocking
    // those resources makes the regression contract deterministic and avoids
    // using WebGL imagery to determine whether a surface is actually opaque.
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => window.__orbitRuntimeStatus?.state || "loading"), { timeout: 15_000 }).toBe("ready");
    await welcome.getByRole("button", { name: "New project", exact: true }).click();

    const projectDialog = page.locator("#projectActionModal");
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByLabel("Nombre del proyecto").fill("Orbit export surface contract");
    await projectDialog.getByRole("button", { name: "Crear proyecto", exact: true }).click();
    await expect(projectDialog).toBeHidden();
}

/**
 * `background-color` is transparent whenever a gradient is used, so inspect
 * the painted background image when present. This protects the actual visual
 * surface rather than a CSS implementation detail.
 */
function readSurface(page, selector) {
    return page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!element) return null;
        const styles = getComputedStyle(element);
        const alphaValues = (value) => [...String(value).matchAll(/rgba?\(([^)]+)\)/gi)].map((match) => {
            const components = match[1].trim().split(/[\s,/]+/).filter(Boolean);
            if (components.length < 4) return 1;
            const raw = components.at(-1);
            const numeric = Number.parseFloat(raw);
            return raw.endsWith("%") ? numeric / 100 : numeric;
        }).filter(Number.isFinite);
        const paint = styles.backgroundImage !== "none" ? styles.backgroundImage : styles.backgroundColor;
        const alphas = alphaValues(paint);
        const borderAlphas = alphaValues(styles.borderTopColor);
        return {
            selector: targetSelector,
            paint,
            opacity: Number(styles.opacity),
            minimumPaintAlpha: alphas.length ? Math.min(...alphas) : 1,
            minimumBorderAlpha: borderAlphas.length ? Math.min(...borderAlphas) : 1
        };
    }, selector);
}

test("orbit export keeps its working surfaces opaque and separates the schedule controls", async ({ page }) => {
    await openWorkspace(page);
    // Persisted workspace density is deliberately exercised elsewhere. This
    // contract measures the normal desktop layout, where all three schedule
    // fields are expected to share one row with a readable gap.
    await page.addStyleTag({ content: ":root { --orbit-ui-scale: 1 !important; }" });
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("orbit:export-open", {
            detail: { id: "2022-023E", sourceFormat: "TLE" }
        }));
    });

    const modal = page.locator("#catalogExportModal");
    const dialog = modal.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Formato").selectOption("kmz");
    await expect(dialog.getByText("KML comprimido", { exact: true })).toBeVisible();

    // The dialog and its main control panel are work surfaces. Neither may
    // reveal the globe behind it; the deliberately translucent backdrop and
    // yellow semantic admonition are excluded from this visual contract.
    const surfaceSelectors = [
        "#catalogExportModal > section[role='dialog']",
        "#catalogExportModal > section[role='dialog'] > section"
    ];
    for (const selector of surfaceSelectors) {
        const surface = await readSurface(page, selector);
        expect(surface, `${selector} must exist`).not.toBeNull();
        expect(surface.opacity, `${selector} must not reduce the opacity of its content`).toBeGreaterThanOrEqual(0.99);
        expect(surface.minimumPaintAlpha, `${selector} must have an opaque painted background`).toBeGreaterThanOrEqual(0.99);
    }
    const dialogSurface = await readSurface(page, "#catalogExportModal > section[role='dialog']");
    expect(dialogSurface.minimumBorderAlpha, "The dialog frame must not become a transparent glass outline").toBeGreaterThanOrEqual(0.99);

    const schedule = await page.evaluate(() => {
        const fields = [...document.querySelectorAll("#catalogExportModal .orbit-export-schedule-fields > label")]
            .map((label) => {
                const rect = label.getBoundingClientRect();
                return { text: label.textContent?.replace(/\s+/g, " ").trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
            });
        return {
            fields,
            horizontalGaps: fields.slice(1).map((field, index) => field.left - fields[index].right)
        };
    });

    expect(schedule.fields.map((field) => field.text)).toEqual(["Fecha inicio", "Fecha fin", "Intervalo (s)"]);
    expect(schedule.fields[1].top, "Dates and interval must remain on one readable row at desktop width").toBeCloseTo(schedule.fields[0].top, 0);
    expect(schedule.fields[2].top, "Dates and interval must remain on one readable row at desktop width").toBeCloseTo(schedule.fields[0].top, 0);
    for (const gap of schedule.horizontalGaps) {
        expect(gap, "Schedule controls must leave a visibly separate interval between adjacent fields").toBeGreaterThanOrEqual(20);
    }
});

test("orbit export identifies the object with the shared satellite glyph", async ({ page }) => {
    await openWorkspace(page);
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("orbit:export-open", {
            detail: { id: "2023-069B", sourceFormat: "TLE" }
        }));
    });

    const dialog = page.locator("#catalogExportModal").getByRole("dialog");
    const icon = dialog.locator("header [data-orbit-icon='satellite']");
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute("viewBox", "0 0 24 24");
    await expect(icon).toHaveAttribute("fill", "none");
    await expect(icon).toHaveAttribute("stroke", "currentColor");

    const geometry = await icon.evaluate((svg) => ({
        bus: svg.querySelector("rect") ? {
            x: svg.querySelector("rect").getAttribute("x"),
            y: svg.querySelector("rect").getAttribute("y"),
            width: svg.querySelector("rect").getAttribute("width"),
            height: svg.querySelector("rect").getAttribute("height")
        } : null,
        solarArrayPaths: svg.querySelectorAll("path").length
    }));
    expect(geometry.bus, "The Layers satellite bus must remain present").toEqual({ x: "9", y: "8", width: "6", height: "8" });
    expect(geometry.solarArrayPaths, "The compact glyph must keep its solar arrays and antenna").toBeGreaterThanOrEqual(2);
});

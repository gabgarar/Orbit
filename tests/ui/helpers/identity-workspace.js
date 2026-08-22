import { expect } from "@playwright/test";

// Every Playwright test gets an isolated browser context, but use distinct
// credentials anyway. That keeps the helper safe if a spec later reuses a
// context to exercise an explicit sign-out/sign-in transition.
let localIdentitySequence = 0;

function nextCredentials() {
    localIdentitySequence += 1;
    const suffix = `${Date.now().toString(36)}-${localIdentitySequence.toString(36)}`;
    return {
        displayName: `UI operator ${localIdentitySequence}`,
        identifier: `ui.operator.${suffix}@orbit.test`,
        password: `orbit-ui-passphrase-${suffix}`
    };
}

/**
 * Creates an account through the rendered identity gate.  This deliberately
 * avoids storage seeding, window globals, and service injection: a browser
 * UI regression must prove that the mandatory access boundary is usable.
 */
export async function createLocalIdentityThroughUi(page, credentials = nextCredentials()) {
    const gate = page.locator("#orbitIdentityGate");
    await expect(gate).toBeVisible({ timeout: 20_000 });

    const panel = gate.getByTestId("identity-access-panel");
    await expect(panel).toBeVisible();

    // The email-first access surface intentionally checks for a local account
    // before it ever displays a password input. A fresh test context has no
    // account, so take the explicit registration path through the real UI.
    await panel.getByLabel("Dirección de correo electrónico").fill(credentials.identifier);
    await panel.getByRole("button", { name: "Regístrate gratis", exact: true }).click();
    await panel.locator("input[autocomplete='name']").fill(credentials.displayName);
    await panel.locator("input[autocomplete='new-password']").fill(credentials.password);
    await panel.getByRole("button", { name: "Crear cuenta local", exact: true }).click();

    // The session is kept only in memory, so hiding this gate proves the UI
    // has completed the real local-account flow rather than a test shortcut.
    await expect(gate).toBeHidden({ timeout: 30_000 });
    return credentials;
}

export async function waitForOrbitRuntimeReady(page, { timeout = 30_000 } = {}) {
    await expect.poll(
        () => page.evaluate(() => window.__orbitRuntimeStatus?.state || "loading"),
        { timeout, message: "Orbit runtime must become ready after local authentication" }
    ).toBe("ready");
}

/**
 * The identity gate transitions first to startup preparation and then to the
 * authenticated project library. Waiting for the library avoids coupling UI
 * tests to the retired welcome-modal / project-action-dialog implementation.
 */
export async function waitForAuthenticatedProjectHub(page, { timeout = 45_000 } = {}) {
    const welcome = page.locator("#projectWelcome");
    await expect(welcome).toBeVisible({ timeout: 30_000 });
    const hub = welcome.getByTestId("authenticated-project-hub");
    await expect(hub).toBeVisible({ timeout });
    await expect(hub.getByLabel("Nombre del proyecto")).toBeEnabled({ timeout });
    return hub;
}

/** Create and open a project through the authenticated user library. */
export async function createProjectThroughHub(page, projectName, { timeout = 45_000 } = {}) {
    const welcome = page.locator("#projectWelcome");
    const hub = await waitForAuthenticatedProjectHub(page, { timeout });
    const name = hub.getByLabel("Nombre del proyecto");
    await name.fill(projectName);
    await hub.getByRole("button", { name: "Crear proyecto", exact: true }).click();

    // Opening is asynchronous: the library first decrypts the document, then
    // the renderer accepts the correlated project-open command. The welcome
    // layer is dismissed only after that handoff succeeds.
    await expect(welcome).toBeHidden({ timeout });
    await expect(page.locator("#topToolbar")).toBeVisible({ timeout });
}

/**
 * Common end-to-end route for UI contracts that need a live scene. It always
 * traverses identity -> authenticated project hub -> project creation.
 */
export async function openWorkspaceThroughLocalIdentity(page, projectName, options = {}) {
    const timeout = options.timeout || 45_000;
    await createLocalIdentityThroughUi(page, options.credentials);
    await waitForOrbitRuntimeReady(page, { timeout });
    await createProjectThroughHub(page, projectName, { timeout });
}

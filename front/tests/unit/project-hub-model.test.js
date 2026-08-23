import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    canProjectUseExternalSync,
    createBlankUserProjectDocument,
    projectLinkageForIdentity
} from "../../../react-ui/src/features/projects/projectHubModel.js";

const projectHubSource = readFileSync(new URL("../../../react-ui/src/features/projects/UserProjectHub.jsx", import.meta.url), "utf8");
const projectHubCss = readFileSync(new URL("../../../react-ui/src/features/projects/UserProjectHub.css", import.meta.url), "utf8");
const projectWelcomeSource = readFileSync(new URL("../../../react-ui/src/components/overlays/ProjectWelcome.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
const accountMenuSource = readFileSync(new URL("../../../react-ui/src/components/AccountMenu.jsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.jsx", import.meta.url), "utf8");
const notificationCenterSource = readFileSync(new URL("../../../react-ui/src/components/overlays/NotificationCenter.jsx", import.meta.url), "utf8");

test("project hub creates a portable blank project with only authored project data", () => {
    const document = createBlankUserProjectDocument("  Mi operación  ");
    assert.equal(document.format, "orbit-project");
    assert.equal(document.version, 1);
    assert.equal(document.name, "Mi operación");
    assert.deepEqual(document.satellites, []);
    assert.deepEqual(document.plannerEvents, []);
    assert.deepEqual(document.plannerHiddenLayerIds, []);
});

test("project linkage follows the authenticated provider without inventing cloud sync", () => {
    assert.deepEqual(projectLinkageForIdentity({ identityState: "local_user" }), {
        provider: "local",
        state: "local_only"
    });
    assert.deepEqual(projectLinkageForIdentity({ identityState: "google_user" }), {
        provider: "google",
        state: "google_linked"
    });
    assert.deepEqual(projectLinkageForIdentity({ identityState: "microsoft_user" }), {
        provider: "microsoft",
        state: "microsoft_linked"
    });
    assert.equal(canProjectUseExternalSync({ linkage: { provider: "google" } }, { identityState: "local_user" }), false);
    assert.equal(canProjectUseExternalSync({ linkage: { provider: "google" } }, { identityState: "google_user", provider: "google" }), true);
    assert.equal(canProjectUseExternalSync({ linkage: { provider: "google" } }, { identityState: "microsoft_user", provider: "microsoft" }), false);
});

test("the project hub waits for the renderer outcome before changing the active encrypted project", () => {
    // Opening a stored document can be cancelled by the renderer's existing
    // replacement confirmation. Keeping activation deferred is a security
    // invariant: an autosave of the old scene must never target the new id.
    assert.match(projectHubSource, /activate:\s*false/);
    assert.match(appSource, /orbit:project-command-complete/);
    assert.match(appSource, /event\?\.detail\?\.reason !== "opened"/);
    assert.match(appSource, /ORBIT_RUNTIME_STATUS_EVENT/);
    assert.match(projectHubSource, /onExportProject/);
});

test("the project hub is one responsive operational window without discarding project actions", () => {
    assert.match(projectWelcomeSource, /orbit-project-hub-shell/);
    assert.match(projectWelcomeSource, /data-testid="authenticated-project-hub"/);
    assert.match(projectHubSource, /orbit-project-hub__topbar/);
    assert.match(projectHubSource, /orbit-project-hub__local-space/);
    assert.match(projectHubSource, /orbit-project-hub__create-controls/);
    assert.match(projectHubSource, /Crea o importa un proyecto/);
    assert.match(projectHubSource, />Crear proyecto<\/span>/);
    assert.match(projectHubSource, />Importar proyecto<\/span>/);
    assert.doesNotMatch(projectHubSource, /Generar desde cero/);
    assert.match(projectHubSource, />Abrir<\/ActionButton>/);
    assert.match(projectHubSource, />Renombrar<\/ActionButton>/);
    assert.match(projectHubSource, />Duplicar<\/ActionButton>/);
    assert.match(projectHubSource, />Exportar<\/ActionButton>/);
    assert.match(projectHubSource, />Eliminar<\/ActionButton>/);
    // The legacy welcome stylesheet made every button flex and oversized. The
    // hub must explicitly isolate its compact controls from that broad rule.
    assert.match(projectHubCss, /#projectWelcome \.orbit-project-hub button\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    assert.match(projectHubCss, /\.orbit-project-hub__create-controls\s*\{[\s\S]*?repeat\(2,/);
    assert.match(projectHubCss, /#projectWelcome > \.orbit-project-hub-shell\s*\{[\s\S]*?overflow:\s*hidden;/);
    assert.match(projectHubCss, /@media \(max-width: 540px\)/);
    assert.doesNotMatch(projectHubCss, /overflow-x:\s*(?:auto|scroll)/);
});

test("account and alert controls are available from both the library and an open scene", () => {
    assert.match(projectHubSource, /aria-controls="orbitNotificationsPanel"/);
    assert.match(projectHubSource, /aria-expanded=\{notificationsOpen\}/);
    assert.match(projectHubSource, /onClick=\{onToggleNotifications\}/);
    assert.match(projectHubSource, /<AccountMenu[\s\S]*?triggerId="projectHubUserBtn"/);
    assert.match(projectHubSource, /<AccountMenu[\s\S]*?onSignOut=\{onSignOut\}/);

    assert.match(accountMenuSource, /aria-haspopup="menu"/);
    assert.match(accountMenuSource, /aria-controls=\{menuId\}/);
    assert.match(accountMenuSource, /aria-expanded=\{open\}/);
    assert.match(accountMenuSource, /role="menu"/);
    assert.match(accountMenuSource, /role="menuitem"/);
    assert.match(accountMenuSource, /event\.key !== "Escape"/);
    assert.match(accountMenuSource, /Informaci.n de usuario/);
    assert.match(accountMenuSource, /Volver a proyectos/);
    assert.match(accountMenuSource, /Cerrar sesi.n/);

    assert.match(toolbarSource, /import AccountMenu/);
    assert.match(toolbarSource, /<AccountMenu/);
    assert.match(toolbarSource, /onOpenProjects=\{onOpenProjectHub\}/);
    assert.match(toolbarSource, /onSignOut=\{onSignOut\}/);
    assert.match(appSource, /<UserProjectHub[\s\S]*?hasNotifications=\{notifications\.length > 0\}[\s\S]*?notificationsOpen=\{notificationsOpen\}[\s\S]*?onToggleNotifications=\{\(\) => setNotificationsOpen/);
    assert.match(appSource, /<TopToolbar[\s\S]*?onSignOut=\{signOut\}/);
    assert.match(notificationCenterSource, /id="orbitNotificationsPanel"/);
    assert.match(notificationCenterSource, /z-\[10600\]/);
});

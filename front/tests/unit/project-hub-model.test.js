import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    canProjectUseExternalSync,
    createBlankUserProjectDocument,
    projectLinkageForIdentity
} from "../../../react-ui/src/features/projects/projectHubModel.js";

const projectHubSource = readFileSync(new URL("../../../react-ui/src/features/projects/UserProjectHub.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");

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

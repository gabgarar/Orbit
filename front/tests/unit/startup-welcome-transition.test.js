import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(
    new URL("../../../react-ui/src/App.jsx", import.meta.url),
    "utf8"
);
const welcome = readFileSync(
    new URL("../../../react-ui/src/components/overlays/ProjectWelcome.jsx", import.meta.url),
    "utf8"
);
const startupPanel = readFileSync(
    new URL("../../../react-ui/src/components/overlays/StartupStatusPanel.jsx", import.meta.url),
    "utf8"
);

test("the startup branch is central and never exposes New/Open project controls", () => {
    const preparationMarker = welcome.indexOf('data-testid="startup-preparing-view"');
    const projectActionsMarker = welcome.indexOf('data-testid="project-welcome-actions"');

    assert.ok(preparationMarker >= 0, "the pending startup view must have a stable marker");
    assert.ok(projectActionsMarker > preparationMarker, "project actions must belong to the ready branch");

    const preparationBranch = welcome.slice(preparationMarker, projectActionsMarker);
    assert.match(preparationBranch, /<StartupStatusPanel startup=\{startup\} authoritative=\{authoritativeSnapshot\} presentationPhase=\{phase\} \/>/);
    assert.match(welcome, /Comprobando los datos locales ya validados/);
    assert.doesNotMatch(preparationBranch, /New project|Open project|project-welcome-actions/);
    assert.match(welcome.slice(projectActionsMarker), /New project/);
    assert.match(welcome.slice(projectActionsMarker), /Open project/);

    // A renderer failure is not a gravity-download retry: its recovery CTA
    // must remain reachable even while startup readiness is still pending.
    assert.match(preparationBranch, /\{runtimeFailed && <RuntimeFailureNotice \/>\}/);
    assert.match(welcome, /Recargar aplicación/);
    assert.match(preparationBranch, /\{!runtimeFailed && <p[^>]*>Este estado se actualiza automáticamente/);
});

test("a failed startup remains centrally observable until service readiness is explicit", () => {
    assert.doesNotMatch(app, /StartupStatusPanel/);
    assert.match(app, /useStartupWelcomePresentation/);
    assert.match(app, /startupPresentation\.allowProjectActions/);
    assert.match(app, /<ProjectWelcome onAction=\{startProjectAction\} runtimeStatus=\{runtimeStatus\} startup=\{startup\} startupPresentation=\{startupPresentation\} \/>/);
    assert.match(app, /getStartupProjectReadiness\(startup\)\.ready/);
    assert.doesNotMatch(app, /isStartupTerminal/);

    // The service owns retries.  The central card shows the real error and
    // explains automatic recovery instead of presenting a non-existent
    // browser-side retry operation.
    assert.match(startupPanel, /status === "error"/);
    assert.match(startupPanel, /errores de descarga se reintentan autom[aá]ticamente/);
    assert.doesNotMatch(startupPanel, /<button[^>]*>[^<]*(?:Reintentar|retry)/i);
});

test("the welcome startup card cannot be dismissed or moved into a floating corner", () => {
    assert.match(startupPanel, /data-testid="startup-status-panel"/);
    assert.doesNotMatch(startupPanel, /<button/);
    assert.doesNotMatch(startupPanel, /fixed top-|right-\[/);
    assert.match(startupPanel, /aria-live="polite"/);
});

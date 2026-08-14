import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const startupPanel = readFileSync(
    new URL("../../../react-ui/src/components/overlays/StartupStatusPanel.jsx", import.meta.url),
    "utf8"
);
const welcome = readFileSync(
    new URL("../../../react-ui/src/components/overlays/ProjectWelcome.jsx", import.meta.url),
    "utf8"
);
const sidebar = readFileSync(
    new URL("../../../react-ui/src/components/WorkspaceSidebar.jsx", import.meta.url),
    "utf8"
);
const bridge = readFileSync(new URL("../../js/runtime/projectEventBridge.js", import.meta.url), "utf8");
const welcomeTheme = readFileSync(
    new URL("../../assets/css/theme.css", import.meta.url),
    "utf8"
);

test("startup UI exposes an accessible determinate-or-indeterminate download progress bar", () => {
    assert.match(startupPanel, /data-testid="startup-progress-bar"/);
    assert.match(startupPanel, /role="progressbar"/);
    assert.match(startupPanel, /aria-valuetext=/);
    assert.match(startupPanel, /bytesDownloaded/);
    assert.match(startupPanel, /totalBytes/);
    assert.match(startupPanel, /animate-pulse/);
    assert.match(startupPanel, /startup-project-gate/);
    assert.match(startupPanel, /data-testid="startup-status-panel"/);
    assert.doesNotMatch(startupPanel, /Ocultar estado de arranque/);
    assert.doesNotMatch(startupPanel, /fixed top-/);
});

test("welcome replaces project actions with one central preparation view until explicit startup readiness", () => {
    assert.match(welcome, /getStartupProjectReadiness/);
    assert.match(welcome, /const preparing = !readiness\.ready/);
    assert.match(welcome, /data-testid="startup-preparing-view"/);
    assert.match(welcome, /<StartupStatusPanel startup=\{startup\} authoritative=\{authoritativeSnapshot\} presentationPhase=\{phase\} \/>/);
    assert.match(welcome, /data-testid="project-welcome-actions"/);
    assert.match(welcome, /\{preparing \? <section/);
    assert.doesNotMatch(welcome, /project-startup-gate/);
    assert.match(welcome, /function RuntimeFailureNotice/);
    assert.match(welcome, /\{runtimeFailed && <RuntimeFailureNotice \/>\}/);
    assert.match(welcome, /\{!runtimeFailed && <p/);
    assert.match(sidebar, /disabled=\{blocked\}/);
    assert.match(sidebar, /project-actions-startup-gate/);
});

test("startup typography keeps alerts readable without inheriting the legacy welcome copy size", () => {
    assert.match(welcome, /const WELCOME_TYPE/);
    assert.match(welcome, /normal: "!font-sans !text-\[16px\] !leading-\[1\.5\]"/);
    assert.match(welcome, /auxiliary: "!font-sans !text-\[13px\] !leading-\[1\.4\]"/);
    assert.match(startupPanel, /const STARTUP_TYPE/);
    assert.match(startupPanel, /normal: "!font-sans !text-\[16px\] !leading-\[1\.4\]"/);
    assert.match(startupPanel, /auxiliary: "!font-sans !text-\[13px\] !leading-\[1\.4\]"/);
    assert.doesNotMatch(startupPanel, /text-\[(?:8|9|10|11|12)px\]/);

    // `font` is a shorthand: the former broad #projectWelcome p rule reset
    // the alert's text size to 20px despite its component class.
    assert.doesNotMatch(welcomeTheme, /^#projectWelcome p\s*\{/m);
    assert.match(welcomeTheme, /#projectWelcome \.project-welcome-card > p\s*\{/);
});

test("legacy project events are guarded independently of React controls", () => {
    assert.match(bridge, /startupAllowsProjectAction/);
    assert.match(bridge, /publishStartupProjectActionBlocked/);
    assert.match(bridge, /filter\(\(command\) => startupAllowsProjectAction/);
});

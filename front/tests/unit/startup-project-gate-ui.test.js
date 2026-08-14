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

test("startup UI exposes an accessible determinate-or-indeterminate download progress bar", () => {
    assert.match(startupPanel, /data-testid="startup-progress-bar"/);
    assert.match(startupPanel, /role="progressbar"/);
    assert.match(startupPanel, /aria-valuetext=/);
    assert.match(startupPanel, /bytesDownloaded/);
    assert.match(startupPanel, /totalBytes/);
    assert.match(startupPanel, /animate-pulse/);
    assert.match(startupPanel, /startup-project-gate/);
});

test("project entry controls remain visibly disabled until explicit startup readiness", () => {
    assert.match(welcome, /getStartupProjectReadiness/);
    assert.match(welcome, /disabled=\{actionsDisabled\}/);
    assert.match(welcome, /project-startup-gate/);
    assert.match(sidebar, /disabled=\{blocked\}/);
    assert.match(sidebar, /project-actions-startup-gate/);
});

test("legacy project events are guarded independently of React controls", () => {
    assert.match(bridge, /startupAllowsProjectAction/);
    assert.match(bridge, /publishStartupProjectActionBlocked/);
    assert.match(bridge, /filter\(\(command\) => startupAllowsProjectAction/);
});

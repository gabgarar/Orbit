import assert from "node:assert/strict";
import test from "node:test";

import {
    getStartupWelcomePresentation,
    hasAuthoritativeStartupSnapshot,
    STARTUP_WELCOME_MINIMUM_PRESENTATION_MS
} from "../../js/features/diagnostics/startupWelcomePresentation.js";

const authoritativeDiagnostics = {
    components: [{ id: "startup", status: "healthy", details: { ready: true } }]
};

const readyStartup = {
    status: "healthy",
    ready: true,
    readiness: { state: "ready" },
    progress: {
        state: "ready",
        completedModels: 2,
        totalModels: 2,
        percent: 100
    }
};

test("a warm cache remains on the central preparation surface for the minimum honest check", () => {
    const beforeMinimum = getStartupWelcomePresentation({
        startup: readyStartup,
        diagnostics: authoritativeDiagnostics,
        availability: "available",
        elapsedMs: STARTUP_WELCOME_MINIMUM_PRESENTATION_MS - 1
    });
    const atMinimum = getStartupWelcomePresentation({
        startup: readyStartup,
        diagnostics: authoritativeDiagnostics,
        availability: "available",
        elapsedMs: STARTUP_WELCOME_MINIMUM_PRESENTATION_MS
    });

    assert.equal(beforeMinimum.authoritativeSnapshot, true);
    assert.equal(beforeMinimum.phase, "verified-cache");
    assert.equal(beforeMinimum.isPreparing, true);
    assert.equal(beforeMinimum.allowProjectActions, false);
    assert.equal(atMinimum.phase, "ready");
    assert.equal(atMinimum.isPreparing, false);
    assert.equal(atMinimum.allowProjectActions, true);
});

test("a ready browser value cannot bypass the first authoritative startup snapshot", () => {
    const presentation = getStartupWelcomePresentation({
        startup: readyStartup,
        diagnostics: null,
        availability: "loading",
        elapsedMs: STARTUP_WELCOME_MINIMUM_PRESENTATION_MS * 2
    });

    assert.equal(hasAuthoritativeStartupSnapshot({ diagnostics: null, availability: "loading" }), false);
    assert.equal(presentation.phase, "awaiting-snapshot");
    assert.equal(presentation.isPreparing, true);
    assert.equal(presentation.allowProjectActions, false);
});

test("an authoritative but not-ready snapshot remains fail-closed after the display interval", () => {
    const presentation = getStartupWelcomePresentation({
        startup: { status: "pending", ready: false, readiness: { state: "pending" } },
        diagnostics: authoritativeDiagnostics,
        availability: "available",
        elapsedMs: STARTUP_WELCOME_MINIMUM_PRESENTATION_MS * 2
    });

    assert.equal(presentation.authoritativeSnapshot, true);
    assert.equal(presentation.phase, "preparing");
    assert.equal(presentation.isPreparing, true);
    assert.equal(presentation.allowProjectActions, false);
});

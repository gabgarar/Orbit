import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "../tests/ui",
    outputDir: "../tests/artifacts/ui-results",
    reporter: [["list"], ["html", { outputFolder: "../tests/artifacts/ui-report", open: "never" }]],
    use: {
        baseURL: process.env.ORBIT_UI_BASE_URL || "http://127.0.0.1:8100",
        screenshot: "only-on-failure",
        trace: "retain-on-failure"
    },
    // These checks boot the full Cesium runtime and deliberately exercise
    // several responsive transitions in one browser session.  The runtime
    // readiness assertion remains 15 s, while this wider per-test budget
    // avoids treating a healthy but GPU-constrained CI worker as a failure.
    timeout: 120_000,
    // Browser contexts are isolated, but their project actions share Orbit's
    // persisted workspace and catalogue service. Keep the suite serial so a
    // project created by one test cannot replace the state inspected by another.
    fullyParallel: false,
    workers: 1
});

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
    timeout: 60_000,
    // Each test has its own browser context and only inspects UI state, so a
    // small worker pool shortens feedback without overloading Cesium/Docker.
    fullyParallel: true,
    workers: Number(process.env.ORBIT_UI_WORKERS) || 2
});

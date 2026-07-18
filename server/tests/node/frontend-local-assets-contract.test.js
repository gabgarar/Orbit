import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "../../..");
const blockedCdn = /https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)\b/i;

async function readProjectFile(...segments) {
    return fs.readFile(path.join(projectRoot, ...segments), "utf8");
}

function assertLocalRuntimeHtml(html, label) {
    assert.doesNotMatch(html, blockedCdn, `${label} must not load a runtime dependency from a CDN`);
    const baseUrlPosition = html.indexOf('window.CESIUM_BASE_URL = "/Cesium/"');
    const scriptPosition = html.indexOf('src="/Cesium/Cesium.js"');
    assert.ok(baseUrlPosition >= 0, `${label} must set CESIUM_BASE_URL`);
    assert.ok(scriptPosition > baseUrlPosition, `${label} must set CESIUM_BASE_URL before loading Cesium`);
    assert.match(html, /href="\/Cesium\/Widgets\/widgets\.css"/);
    assert.match(html, /src="\/vendor\/pako\.min\.js"/);
}

test("frontend packages and serves Cesium and pako locally", async () => {
    const [reactHtml, legacyHtml, websocketRuntime, viteConfig, packageFile, vendorScript, buildValidator, dockerfile, dockerignore] = await Promise.all([
        readProjectFile("react-ui", "index.html"),
        readProjectFile("front", "index.html"),
        readProjectFile("front", "js", "SatelliteWebSocket.js"),
        readProjectFile("react-ui", "vite.config.js"),
        readProjectFile("react-ui", "package.json"),
        readProjectFile("react-ui", "scripts", "vendor-runtime-assets.mjs"),
        readProjectFile("react-ui", "scripts", "validate-local-runtime-assets.mjs"),
        readProjectFile("Dockerfile"),
        readProjectFile(".dockerignore")
    ]);

    assertLocalRuntimeHtml(reactHtml, "React entry HTML");
    assertLocalRuntimeHtml(legacyHtml, "Legacy entry HTML");
    assert.doesNotMatch(websocketRuntime, blockedCdn);
    assert.doesNotMatch(websocketRuntime, /import\s*\(/, "WebSocket decompression must not dynamically import pako");
    assert.match(websocketRuntime, /window\.pako\?\.inflate/);
    assert.match(viteConfig, /copyLocalRuntimeAssets/);
    assert.match(viteConfig, /publicDir:\s*"\.runtime-vendor"/);
    assert.match(viteConfig, /path\.join\(outputDirectory, "Cesium"\)/);
    assert.match(viteConfig, /path\.join\(outputDirectory, "vendor", "pako\.min\.js"\)/);
    assert.match(vendorScript, /async function packPackage/);
    assert.match(vendorScript, /"pack",/);
    assert.match(vendorScript, /cesium@\$\{versions\.cesium\}/);
    assert.match(vendorScript, /pako@\$\{versions\.pako\}/);
    assert.match(vendorScript, /Build", "Cesium/);
    assert.match(vendorScript, /dist", "pako\.min\.js/);
    assert.match(buildValidator, /Cesium\/Workers/);
    assert.match(buildValidator, /Cesium\/Assets/);
    assert.match(buildValidator, /CDN reference found in generated frontend asset/);
    assert.match(vendorScript, /Unable to download pinned runtime package/);
    assert.match(dockerfile, /npm run build --prefix react-ui/);
    assert.match(dockerfile, /apt-get install -y --no-install-recommends python3 python3-venv tar/);
    assert.match(dockerignore, /^react-ui\/\.runtime-vendor\/?$/m);

    const packageConfig = JSON.parse(packageFile);
    assert.equal(packageConfig.orbitRuntimeDependencies.cesium, "1.143.0");
    assert.equal(packageConfig.orbitRuntimeDependencies.pako, "2.1.0");
    assert.match(packageConfig.scripts.build, /vendor-runtime-assets/);
    assert.match(packageConfig.scripts.build, /validate-local-runtime-assets/);
});

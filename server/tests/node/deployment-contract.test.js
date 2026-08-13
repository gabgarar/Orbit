import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "../../..");

async function readProjectFile(...segments) {
    return fs.readFile(path.join(projectRoot, ...segments), "utf8");
}

test("Docker local-only bind and host-port override stay aligned with restart and UI scripts", async () => {
    const [compose, dockerfile, dockerignore, restartScript, restartCommand, uiScript, bindScript] = await Promise.all([
        readProjectFile("compose.yaml"),
        readProjectFile("Dockerfile"),
        readProjectFile(".dockerignore"),
        readProjectFile(".scripts", "restart-orbit.ps1"),
        readProjectFile(".scripts", "restart-orbit.cmd"),
        readProjectFile(".scripts", "test-ui.ps1"),
        readProjectFile(".scripts", "orbit-http-bind.ps1")
    ]);

    assert.match(compose, /\$\{ORBIT_HTTP_BIND:-127\.0\.0\.1\}:\$\{ORBIT_HTTP_PORT:-8100\}:8100/);
    assert.match(compose, /PORT:\s*"8100"/);
    assert.match(compose, /ORBIT_PYTHON_STARTUP_TIMEOUT_MS:\s*"\$\{ORBIT_PYTHON_STARTUP_TIMEOUT_MS:-180000\}"/);
    assert.doesNotMatch(compose, /8765:8765/);
    assert.doesNotMatch(dockerfile, /EXPOSE\s+8100\s+8765/);
    assert.match(dockerfile, /npm run test:node --prefix server/);
    assert.match(dockerfile, /npm run test:frontend --prefix server/);
    assert.match(dockerfile, /\/opt\/venv\/bin\/python -m pytest server\/python\/tests/);
    assert.match(dockerfile, /HEALTHCHECK --interval=10s --timeout=5s --start-period=10m --retries=5/);
    assert.ok(
        dockerfile.lastIndexOf("COPY config/ ./config/") > dockerfile.indexOf("RUN npm run build --prefix react-ui"),
        "runtime config must be copied after the expensive test and frontend build layers"
    );
    assert.ok(
        dockerfile.indexOf("COPY config/eop/ ./config/eop/") < dockerfile.indexOf("RUN npm run test:node --prefix server"),
        "the pinned leap-second snapshot must be available to the image test layer"
    );
    assert.ok(
        dockerfile.indexOf("RUN node server/scripts/validate-image-config.js") > dockerfile.lastIndexOf("COPY config/ ./config/"),
        "the copied runtime configuration must be validated inside the image"
    );
    assert.match(dockerfile, /^FROM python:[^\s]+ AS docs-builder$/m);
    assert.match(dockerfile, /^COPY requirements-docs\.txt \.\/$/m);
    assert.match(dockerfile, /^COPY mkdocs\.yml \.\/$/m);
    assert.match(dockerfile, /^COPY docs\/wiki\/ \.\/docs\/wiki\/$/m);
    assert.match(dockerfile, /^RUN mkdocs build --strict --site-dir \/docs\/site$/m);
    assert.match(dockerfile, /^COPY --from=docs-builder \/docs\/site\/ \.\/docs-site\/$/m);
    assert.match(dockerignore, /^front\/dist\/?$/m);
    assert.match(dockerignore, /^react-ui\/dist\/?$/m);
    assert.match(dockerignore, /^server\/ui-artifacts\/?$/m);
    assert.match(dockerignore, /^server\/debug\.log$/m);
    assert.match(dockerignore, /^site\/$/m);
    assert.doesNotMatch(dockerignore, /^docs\/$/m, "docs/wiki must remain available to the docs-builder stage");
    for (const ignoredBuildInput of [".venv/", ".venv-docs/", "site/", "tests/", "debug.log"]) {
        assert.match(
            dockerignore,
            new RegExp(`^${ignoredBuildInput.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
            `${ignoredBuildInput} must stay out of the Docker build context`
        );
    }
    assert.match(restartScript, /Get-OrbitHttpPort/);
    assert.match(restartScript, /Get-OrbitHttpBind/);
    assert.match(restartScript, /ORBIT_HTTP_PORT\s*=\s*"\$orbitHttpPort"/);
    assert.match(restartScript, /ORBIT_HTTP_BIND\s*=\s*\$orbitHttpBind/);
    assert.match(restartScript, /\$defaultPythonStartupTimeoutMs\s*=\s*180000/);
    assert.match(restartScript, /\$maximumPythonStartupTimeoutMs\s*=\s*600000/);
    assert.match(restartScript, /\$composeWaitTimeoutSeconds\s*=\s*\[Math\]::Ceiling\(\$pythonStartupTimeoutMs\s*\/\s*1000\.0\)\s*\+\s*60/);
    assert.match(restartScript, /--wait-timeout\s+\$composeWaitTimeoutSeconds/);
    assert.match(restartScript, /\[switch\]\$SkipBuild/);
    assert.match(restartScript, /\[switch\]\$NoCache/);
    assert.match(restartScript, /\$buildArguments\s*=\s*@\("compose", "build", "orbit"\)/);
    assert.match(restartScript, /if\s*\(\$NoCache\)\s*\{\s*\$buildArguments\s*=\s*@\("compose", "build", "--no-cache", "orbit"\)/);
    assert.match(restartCommand, /restart-orbit\.ps1" %\*/);
    assert.match(uiScript, /Get-OrbitHttpPort/);
    assert.match(uiScript, /Get-OrbitHttpBind/);
    assert.match(uiScript, /ORBIT_HTTP_BIND\s*=\s*\$orbitHttpBind/);
    assert.match(uiScript, /ORBIT_UI_BASE_URL\s*=\s*\$orbitBaseUrl/);
    assert.match(uiScript, /\$orbitBaseUrl\/health/);
    assert.match(bindScript, /"127\.0\.0\.1"/);
    assert.match(bindScript, /"0\.0\.0\.0"/);
    assert.match(bindScript, /ORBIT_HTTP_BIND must be 127\.0\.0\.1/);
    const buildIndex = restartScript.indexOf("& docker @buildArguments");
    const stopIndex = restartScript.indexOf("docker compose down");
    assert.ok(
        buildIndex >= 0 && stopIndex >= 0 && buildIndex < stopIndex,
        "the image build invocation must be present before the current service is stopped"
    );
});

test("full test runner isolates child scripts so their exit codes do not terminate the suite early", async () => {
    const testAllScript = await readProjectFile(".scripts", "test-all.ps1");

    assert.match(testAllScript, /\$scriptPath\s*=\s*Join-Path\s+\$scriptsRoot\s+\$scriptName/);
    assert.match(testAllScript, /powershell\.exe\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+\$scriptPath/);
    assert.match(testAllScript, /if\s*\(\$LASTEXITCODE\s+-ne\s+0\)\s*\{\s*exit\s+\$LASTEXITCODE\s*\}/);
    assert.doesNotMatch(testAllScript, /&\s*\(Join-Path\s+\$scriptsRoot\s+\$scriptName\)/);
});

test("Compose pins the bundled IERS leap-second snapshot required by precise GNSS ECI", async () => {
    const [compose, snapshot, snapshotReadme] = await Promise.all([
        readProjectFile("compose.yaml"),
        readProjectFile("config", "eop", "leap-seconds.list"),
        readProjectFile("config", "eop", "README.md")
    ]);
    const expectedSha256 = "db5a895f16853b03bfc865e8d68f9fc8710ef1740e3400c701cd46a5bbbc3433";

    assert.equal(createHash("sha256").update(snapshot).digest("hex"), expectedSha256);
    assert.match(snapshot, /#@\s+4023129600/);
    assert.match(snapshot, /File expires on 28 June 2027/);
    assert.match(compose, /ORBIT_LEAP_SECONDS_PATH:\s*"\$\{ORBIT_LEAP_SECONDS_PATH:-\/app\/config\/eop\/leap-seconds\.list\}"/);
    assert.match(compose, new RegExp(`ORBIT_LEAP_SECONDS_SHA256:\\s*"\\$\\{ORBIT_LEAP_SECONDS_SHA256:-${expectedSha256}\\}"`));
    assert.match(compose, /ORBIT_LEAP_SECONDS_VERSION:\s*"\$\{ORBIT_LEAP_SECONDS_VERSION:-IERS-Bulletin-C-72-2026-07-06\}"/);
    assert.match(compose, /ORBIT_LEAP_SECONDS_REQUIRED:\s*"\$\{ORBIT_LEAP_SECONDS_REQUIRED:-true\}"/);
    assert.match(compose, /ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED:\s*"\$\{ORBIT_LEAP_SECONDS_REQUIRE_UNEXPIRED:-true\}"/);
    assert.match(snapshotReadme, /hpiers\.obspm\.fr\/iers\/bul\/bulc\/ntp\/leap-seconds\.list/);
    assert.match(snapshotReadme, new RegExp(expectedSha256));
});

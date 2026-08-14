import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "../../..");

async function readProjectFile(...segments) {
    return fs.readFile(path.join(projectRoot, ...segments), "utf8");
}

test("quality workflow keeps the complete scientific and build validation gates", async () => {
    const quality = await readProjectFile(".github", "workflows", "quality.yml");

    assert.match(quality, /^on:\s*\n\s+push:\s*\n\s+pull_request:/m);
    assert.match(quality, /cache: npm/);
    assert.match(quality, /cache: pip/);
    assert.match(quality, /npm run test:node --prefix server/);
    assert.match(quality, /npm run test:frontend --prefix server/);
    assert.match(quality, /npm run test:react-build --prefix server/);
    assert.match(quality, /python -m mkdocs build --strict/);
    assert.match(quality, /server\/python\/tests\/timekeeping\/test_eop\.py/);
    assert.match(quality, /server\/python\/tests\/frames\/test_transform_invariants\.py/);
    assert.match(quality, /server\/python\/tests\/formats\/test_sp3_strict_validation\.py/);
    assert.match(quality, /server\/python\/tests\/formats\/test_oem_states\.py/);
    assert.match(quality, /server\/python\/tests\/orbits\/propagators\/test_propagation_invariants\.py/);
    assert.match(quality, /server\/python\/tests\/orbits\/forces\/test_geopotential\.py/);
    assert.match(quality, /python -m pytest -q server\/python\/tests/);
    assert.match(quality, /npx knip/);
    assert.match(quality, /eslint front react-ui\/src server\/src server\/tests/);
    assert.match(quality, /ruff check server\/python\/orbit_api/);
    assert.match(quality, /vulture server\/python\/orbit_api/);
});

test("documentation workflow validates content on reviews and publishes only main", async () => {
    const [pagesWorkflow, config] = await Promise.all([
        readProjectFile(".github", "workflows", "docs-pages.yml"),
        readProjectFile("mkdocs.yml")
    ]);

    assert.match(pagesWorkflow, /branches: \[main\]/);
    assert.doesNotMatch(pagesWorkflow, /branches: \[develop\]/);
    assert.match(pagesWorkflow, /^\s+pull_request:/m);
    assert.match(pagesWorkflow, /python -m mkdocs build --strict/);
    assert.match(pagesWorkflow, /test -f site\/index\.html/);
    assert.match(pagesWorkflow, /test -f site\/en\/index\.html/);
    assert.match(pagesWorkflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(pagesWorkflow, /actions\/upload-pages-artifact@v4/);
    assert.match(pagesWorkflow, /actions\/deploy-pages@v4/);
    assert.match(pagesWorkflow, /cache: pip/);
    assert.match(config, /^validation:\s*$/m);
    assert.match(config, /^\s+not_found: warn$/m);
    assert.match(config, /^\s+anchors: warn$/m);
});

test("real-data validation is manually dispatched, cached, and cannot make quality CI download data", async () => {
    const [quality, realData, wrapper, command] = await Promise.all([
        readProjectFile(".github", "workflows", "quality.yml"),
        readProjectFile(".github", "workflows", "real-data.yml"),
        readProjectFile(".scripts", "test-real-data.ps1"),
        readProjectFile(".scripts", "test-real-data.cmd")
    ]);

    assert.match(realData, /^on:\s*\n\s+workflow_dispatch:/m);
    assert.doesNotMatch(realData, /^\s+push:/m);
    assert.doesNotMatch(realData, /^\s+pull_request:/m);
    assert.match(realData, /performance:/);
    assert.match(realData, /actions\/cache@v4/);
    assert.match(realData, /path: data\/test-real-data/);
    assert.match(realData, /ORBIT_RUN_REAL_DATA: "1"/);
    assert.match(realData, /ORBIT_DOWNLOAD_REAL_DATA: "1"/);
    assert.match(realData, /ORBIT_RUN_REAL_DATA_PERFORMANCE:/);
    assert.match(realData, /server\/python\/tests\/infrastructure\/test_real_data_cache\.py/);
    assert.match(realData, /server\/python\/tests\/integration\/test_real_data_integration\.py/);
    assert.match(quality, /ORBIT_RUN_REAL_DATA: "0"/);
    assert.match(quality, /ORBIT_DOWNLOAD_REAL_DATA: "0"/);
    assert.match(quality, /ORBIT_RUN_REAL_DATA_PERFORMANCE: "0"/);
    assert.match(wrapper, /\[switch\]\$Download/);
    assert.match(wrapper, /\[switch\]\$Performance/);
    assert.match(wrapper, /\[switch\]\$IncludeIers/);
    assert.match(wrapper, /ORBIT_DOWNLOAD_REAL_DATA = if \(\$Download\)/);
    assert.match(wrapper, /tests_support\.real_data/);
    assert.match(wrapper, /test_real_data_integration\.py/);
    assert.match(command, /test-real-data\.ps1/);
});

test("release workflow validates SemVer tags and verifies uploaded artifact checksums", async () => {
    const release = await readProjectFile(".github", "workflows", "release.yml");
    const checksumChecks = release.match(/sha256sum --check --strict SHA256SUMS\.txt/g) || [];

    assert.match(release, /tags:\s*\n\s+- "v\*\.\*\.\*"/);
    assert.match(release, /semver_pattern='\^v\[0-9\]\+/);
    assert.match(release, /cache: npm/);
    assert.match(release, /cache: pip/);
    assert.match(release, /npm run build --prefix react-ui/);
    assert.match(release, /sha256sum "\$\{artifact_name\}\.tar\.gz" > SHA256SUMS\.txt/);
    assert.equal(checksumChecks.length >= 2, true, "checksum must be verified before upload and before release publication");
    assert.match(release, /tar -tzf/);
    assert.match(release, /actions\/upload-artifact@v4/);
    assert.match(release, /gh release upload/);
});

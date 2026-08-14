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

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

test("Docker excludes mutable precise products while Compose supplies them at runtime", async () => {
    const [dockerignore, dockerfile, compose, repository] = await Promise.all([
        readProjectFile(".dockerignore"),
        readProjectFile("Dockerfile"),
        readProjectFile("compose.yaml"),
        readProjectFile("server", "python", "orbit_api", "application", "precise_products.py")
    ]);

    assert.match(dockerignore, /^config\/precise-products\/?$/m);
    assert.match(dockerfile, /^COPY config\/ \.\/config\/$/m);
    assert.match(compose, /^\s*- \.\/config:\/app\/config\s*$/m);
    assert.match(repository, /self\.root\.mkdir\(parents=True, exist_ok=True\)/);
});

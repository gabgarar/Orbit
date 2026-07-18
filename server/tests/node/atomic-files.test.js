import test from "node:test";
import assert from "node:assert/strict";
import { writeFileAtomically } from "../../src/shared/files.js";

test("atomic writes remove their temporary file after a failed rename", async () => {
    const calls = [];
    const fileSystem = {
        writeFile: async (filePath) => calls.push(["write", filePath]),
        rename: async () => { throw new Error("rename failed"); },
        rm: async (filePath) => calls.push(["remove", filePath])
    };
    await assert.rejects(writeFileAtomically("/config/catalog.json", "{}", { fileSystem }), /rename failed/);
    assert.equal(calls[0][0], "write");
    assert.equal(calls[1][0], "remove");
    assert.equal(calls[0][1], calls[1][1]);
});

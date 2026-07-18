import assert from "node:assert/strict";
import test from "node:test";
import { downloadProjectDocument, readProjectDocument, saveProjectDocument, serializeProjectDocument } from "../../js/runtime/projectFileIO.js";

test("project file IO serializes, reads, and saves a stable JSON document", async () => {
    const project = { format: "orbit-project", version: 1, name: "Mission" };
    assert.deepEqual(await readProjectDocument({ text: async () => serializeProjectDocument(project) }), project);

    const writes = [];
    await saveProjectDocument({ createWritable: async () => ({ write: async (value) => writes.push(value), close: async () => writes.push("closed") }) }, project);
    assert.equal(writes[0], serializeProjectDocument(project));
    assert.equal(writes[1], "closed");
});

test("project file IO revokes the download URL after clicking its anchor", () => {
    const calls = [];
    const anchor = { click: () => calls.push("click") };
    downloadProjectDocument({ name: "Mission" }, {
        documentRef: { createElement: () => anchor },
        urlApi: { createObjectURL: () => "blob:project", revokeObjectURL: (url) => calls.push(url) },
        fileName: "mission.json"
    });
    assert.equal(anchor.href, "blob:project");
    assert.equal(anchor.download, "mission.json");
    assert.deepEqual(calls, ["click", "blob:project"]);
});

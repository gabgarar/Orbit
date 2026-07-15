import test from "node:test";
import assert from "node:assert/strict";
import { createLayerTree } from "../../js/features/layers/layerTree.js";

function memoryStorage() { const data = new Map(); return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; }

test("layer tree creates nested folders and assigns layers", () => {
    const tree = createLayerTree(memoryStorage());
    const missions = tree.createFolder("Missions");
    const leo = tree.createFolder("LEO", missions);
    tree.move("ISS", leo);
    assert.equal(tree.snapshot(["ISS"]).layerParents.ISS, leo);
    assert.equal(tree.snapshot([]).folders.find((item) => item.id === leo).parentId, missions);
});

test("layer tree prevents moving a folder into itself or descendants", () => {
    const tree = createLayerTree(memoryStorage());
    const parent = tree.createFolder("Parent");
    const child = tree.createFolder("Child", parent);
    assert.equal(tree.move(parent, child), false);
    assert.equal(tree.move(child, child), false);
});

test("removing a folder returns direct children to root", () => {
    const tree = createLayerTree(memoryStorage());
    const folder = tree.createFolder("Temporary");
    tree.move("ISS", folder);
    tree.removeFolder(folder);
    assert.equal(tree.snapshot(["ISS"]).layerParents.ISS, null);
});

test("layer tree restores exported hierarchy and can clear it", () => {
    const tree = createLayerTree(memoryStorage());
    tree.replace({
        folders: [
            { id: "missions", name: "Missions", parentId: null, expanded: true },
            { id: "leo", name: "LEO", parentId: "missions", expanded: false }
        ],
        layerParents: { ISS: "leo" }
    });
    assert.equal(tree.snapshot(["ISS"]).layerParents.ISS, "leo");
    assert.equal(tree.snapshot([]).folders.find((folder) => folder.id === "leo").parentId, "missions");
    tree.clear();
    assert.deepEqual(tree.snapshot(["ISS"]), { folders: [], layerParents: { ISS: null } });
});

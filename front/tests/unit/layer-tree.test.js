import test from "node:test";
import assert from "node:assert/strict";
import { createLayerTree, getLayerFolderCounts, getVisibleLayerFolderIds } from "../../js/features/layers/layerTree.js";

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

test("empty folders remain visible outside search so they can receive future layers", () => {
    const folders = [
        { id: "missions", name: "Missions", parentId: null, expanded: true },
        { id: "future", name: "Future launch", parentId: "missions", expanded: true }
    ];

    assert.deepEqual(
        [...getVisibleLayerFolderIds({ folders, layerParents: {}, layerIds: [], filtering: false })].sort(),
        ["future", "missions"]
    );
});

test("folder search keeps a matching empty folder and its parent, not unrelated branches", () => {
    const folders = [
        { id: "missions", name: "Missions", parentId: null, expanded: true },
        { id: "future", name: "Future launch", parentId: "missions", expanded: true },
        { id: "archive", name: "Archive", parentId: null, expanded: true }
    ];

    assert.deepEqual(
        [...getVisibleLayerFolderIds({
            folders,
            layerParents: {},
            layerIds: [],
            filtering: true,
            matchingFolderIds: ["future"]
        })].sort(),
        ["future", "missions"]
    );
});

test("folder counters include descendant operational layers and retain empty folders", () => {
    const folders = [
        { id: "operations", name: "Operations", parentId: null, expanded: true },
        { id: "leo", name: "LEO", parentId: "operations", expanded: true },
        { id: "future", name: "Future", parentId: "operations", expanded: true }
    ];

    const counts = getLayerFolderCounts({
        folders,
        layerParents: { station: "operations", iss: "leo" },
        layerIds: ["station", "iss"]
    });

    assert.deepEqual(Object.fromEntries(counts), { operations: 2, leo: 1, future: 0 });
});

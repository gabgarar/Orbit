import test from "node:test";
import assert from "node:assert/strict";
import {
    createLayerTree,
    getLayerFolderCounts,
    getLayerFolderDescendantIds,
    getLayerFolderLayerIds,
    getVisibleLayerFolderIds
} from "../../js/features/layers/layerTree.js";

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
    const child = tree.createFolder("Child", folder);
    const nested = tree.createFolder("Nested", child);
    tree.move("ISS", folder);
    tree.removeFolder(folder);
    assert.equal(tree.snapshot(["ISS"]).layerParents.ISS, null);
    const folders = tree.snapshot([]).folders;
    assert.equal(folders.find((item) => item.id === child).parentId, null);
    assert.equal(folders.find((item) => item.id === nested).parentId, child);
});

test("folder helpers resolve nested folders and the layers they contain", () => {
    const folders = [
        { id: "mission", name: "Mission", parentId: null, expanded: true },
        { id: "leo", name: "LEO", parentId: "mission", expanded: true },
        { id: "science", name: "Science", parentId: "leo", expanded: true },
        { id: "archive", name: "Archive", parentId: null, expanded: true }
    ];
    const layerParents = { station: "mission", iss: "leo", hubble: "science", retired: "archive" };

    assert.deepEqual(
        [...getLayerFolderDescendantIds({ folders, folderId: "mission" })].sort(),
        ["leo", "mission", "science"]
    );
    assert.deepEqual(
        getLayerFolderLayerIds({
            folders,
            layerParents,
            layerIds: ["station", "iss", "hubble", "retired"],
            folderId: "mission"
        }),
        ["station", "iss", "hubble"]
    );
});

test("tree instances expose descendant layers for folder-level visibility actions", () => {
    const tree = createLayerTree(memoryStorage());
    const mission = tree.createFolder("Mission");
    const leo = tree.createFolder("LEO", mission);
    tree.move("ISS", leo);
    tree.move("Station", mission);

    assert.deepEqual([...tree.getFolderDescendantIds(mission)].sort(), [leo, mission].sort());
    assert.deepEqual(tree.getFolderLayerIds(mission, ["ISS", "Station", "Other"]), ["ISS", "Station"]);
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

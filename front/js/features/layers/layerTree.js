/** Persisted, presentation-only hierarchy for active Orbit layers. */
export function createLayerTree(storage = globalThis.localStorage, key = "orbit.layerTree.v1") {
    let state = read(storage, key);
    const save = () => storage?.setItem?.(key, JSON.stringify(state));
    const folderById = () => new Map(state.folders.map((folder) => [folder.id, folder]));

    function createFolder(name, parentId = null) {
        const title = String(name || "").trim();
        if (!title) return null;
        const id = `folder:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        state.folders.push({ id, name: title, parentId: validParent(parentId), expanded: true });
        save();
        return id;
    }

    function renameFolder(id, name) {
        const folder = folderById().get(id);
        const title = String(name || "").trim();
        if (!folder || !title) return false;
        folder.name = title; save(); return true;
    }

    function move(id, parentId = null) {
        const parent = validParent(parentId);
        if (id === parent || isDescendant(parent, id)) return false;
        const folder = folderById().get(id);
        if (folder) folder.parentId = parent;
        else state.layerParents[id] = parent;
        save(); return true;
    }

    function removeFolder(id) {
        const folders = folderById();
        if (!folders.has(id)) return false;
        state.folders.forEach((folder) => { if (folder.parentId === id) folder.parentId = null; });
        Object.keys(state.layerParents).forEach((layerId) => { if (state.layerParents[layerId] === id) state.layerParents[layerId] = null; });
        state.folders = state.folders.filter((folder) => folder.id !== id);
        save(); return true;
    }

    function toggle(id) { const folder = folderById().get(id); if (!folder) return false; folder.expanded = !folder.expanded; save(); return folder.expanded; }
    function snapshot(layerIds) { return { folders: state.folders.map((item) => ({ ...item })), layerParents: Object.fromEntries(layerIds.map((id) => [id, state.layerParents[id] || null])) }; }
    function replace(snapshot) {
        const rawFolders = Array.isArray(snapshot?.folders) ? snapshot.folders : [];
        const ids = new Set();
        const folders = rawFolders.reduce((items, folder) => {
            const id = String(folder?.id || "").trim();
            const name = String(folder?.name || "").trim();
            if (!id || !name || ids.has(id)) return items;
            ids.add(id);
            items.push({ id, name, parentId: folder.parentId || null, expanded: folder.expanded !== false });
            return items;
        }, []);
        const byId = new Set(folders.map((folder) => folder.id));
        folders.forEach((folder) => {
            const parentId = folder.parentId;
            folder.parentId = parentId && parentId !== folder.id && byId.has(parentId) ? parentId : null;
        });
        const rawParents = snapshot?.layerParents && typeof snapshot.layerParents === "object" ? snapshot.layerParents : {};
        const layerParents = Object.fromEntries(Object.entries(rawParents).map(([layerId, parentId]) => [
            String(layerId),
            parentId && byId.has(parentId) ? parentId : null
        ]));
        state = { folders, layerParents };
        save();
        return snapshot;
    }
    function clear() { state = { folders: [], layerParents: {} }; save(); }
    function validParent(id) { return id && folderById().has(id) ? id : null; }
    function isDescendant(candidateId, ancestorId) { let current = folderById().get(candidateId); while (current?.parentId) { if (current.parentId === ancestorId) return true; current = folderById().get(current.parentId); } return false; }
    return { createFolder, renameFolder, move, removeFolder, toggle, snapshot, replace, clear };
}

function read(storage, key) {
    try {
        const value = JSON.parse(storage?.getItem?.(key) || "");
        if (value && Array.isArray(value.folders) && value.layerParents && typeof value.layerParents === "object") return value;
    } catch { /* reset malformed persisted UI state */ }
    return { folders: [], layerParents: {} };
}

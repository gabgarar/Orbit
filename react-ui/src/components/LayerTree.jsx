import { useEffect, useMemo, useState } from "react";

const emit = (type, detail) => window.dispatchEvent(new CustomEvent("orbit:layer-tree-action", { detail: { type, ...detail } }));

function LayerRow({ layer }) {
    return <div className={`object-list-row${layer.selected ? " active" : ""}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", layer.id)} onContextMenu={(event) => { event.preventDefault(); emit("context", { id: layer.id, x: event.clientX, y: event.clientY }); }}>
        <button className={`object-list-item${layer.selected ? " active" : ""}`} type="button" onClick={() => emit("select", { id: layer.id })} onDoubleClick={() => emit("focus", { id: layer.id })}>{layer.name} {layer.type && <span className="catalog-format-badge">{layer.type}</span>} {layer.format && <span className="catalog-format-badge">{layer.format}</span>}</button>
        <button className="object-remove-layer-btn" type="button" aria-label="Quitar capa" onClick={() => emit("remove", { id: layer.id })}>&#215;</button>
        <button className={`object-visibility-btn${layer.visible ? "" : " is-hidden"}`} type="button" aria-label={layer.visible ? "Ocultar capa" : "Mostrar capa"} onClick={() => emit("visibility", { id: layer.id, visible: !layer.visible })}>{layer.visible ? "◉" : "○"}</button>
    </div>;
}

function Folder({ folder, folders, layers, parents }) {
    const children = folders.filter((item) => item.parentId === folder.id);
    const ownLayers = layers.filter((layer) => parents[layer.id] === folder.id);
    return <section className="layer-tree-folder" onDragOver={(event) => event.preventDefault()} onDrop={(event) => emit("move", { id: event.dataTransfer.getData("text/plain"), folderId: folder.id })}>
        <div className="layer-tree-folder-header" draggable onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("text/plain", folder.id); event.dataTransfer.effectAllowed = "move"; }}><button type="button" onClick={() => emit("toggle-folder", { id: folder.id })}><span className="layer-tree-chevron">{folder.expanded ? "▾" : "▸"}</span><span className="layer-tree-icon">▱</span><span>{folder.name}</span></button><button type="button" aria-label="Renombrar carpeta" onClick={() => emit("rename-folder", { id: folder.id, name: folder.name })}>✎</button><button type="button" aria-label="Añadir subcarpeta" onClick={() => emit("create-folder", { parentId: folder.id, title: "Nueva subcarpeta", label: "Nombre de la subcarpeta" })}>+</button><button type="button" aria-label="Eliminar carpeta" onClick={() => emit("delete-folder", { id: folder.id, name: folder.name })}>×</button></div>
        {folder.expanded && <div className="layer-tree-folder-body">{children.map((item) => <Folder key={item.id} folder={item} folders={folders} layers={layers} parents={parents} />)}{ownLayers.map((layer) => <LayerRow key={layer.id} layer={layer} />)}</div>}
    </section>;
}

export default function LayerTree() {
    const [state, setState] = useState({ layers: [], tree: { folders: [], layerParents: {} } });
    useEffect(() => {
        const update = (event) => setState(event.detail || { layers: [], tree: { folders: [], layerParents: {} } });
        window.addEventListener("orbit:layer-tree-state", update);
        return () => window.removeEventListener("orbit:layer-tree-state", update);
    }, []);
    const { layers, tree } = state;
    const rootLayers = useMemo(() => layers.filter((layer) => !tree.layerParents[layer.id]), [layers, tree.layerParents]);
    return <div className="react-layer-tree" onDragOver={(event) => event.preventDefault()} onDrop={(event) => emit("move", { id: event.dataTransfer.getData("text/plain"), folderId: null })}>
        {tree.folders.filter((folder) => !folder.parentId).map((folder) => <Folder key={folder.id} folder={folder} folders={tree.folders} layers={layers} parents={tree.layerParents} />)}
        {rootLayers.map((layer) => <LayerRow key={layer.id} layer={layer} />)}
        <div className="object-list-row object-list-row-add"><button className="object-list-item object-list-add-item" type="button" onClick={() => emit("add", {})}><span className="object-list-add-plus">+</span><span>Añadir capa</span></button><button className="object-list-item object-list-add-item" type="button" onClick={() => emit("create-folder", { parentId: null, title: "Nueva carpeta", label: "Nombre de la carpeta" })}>Nueva carpeta</button></div>
    </div>;
}

import { useEffect, useRef, useState } from "react";

const action = (type, detail = {}) => window.dispatchEvent(new CustomEvent("orbit:catalog-action", { detail: { type, ...detail } }));

export default function CatalogModal() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState({ rows: [], page: 1, totalPages: 1, total: 0, selected: [], filters: {} });
    const importInput = useRef(null);
    useEffect(() => {
        const onOpen = () => setOpen(true); const onClose = () => setOpen(false); const onState = (event) => setState(event.detail || {});
        window.addEventListener("orbit:catalog-open", onOpen); window.addEventListener("orbit:catalog-close", onClose); window.addEventListener("orbit:catalog-state", onState);
        return () => { window.removeEventListener("orbit:catalog-open", onOpen); window.removeEventListener("orbit:catalog-close", onClose); window.removeEventListener("orbit:catalog-state", onState); };
    }, []);
    if (!open) return null;
    return <div id="catalogModal" className="open" onMouseDown={(event) => event.target === event.currentTarget && action("close")}><section className="catalog-modal-panel" role="dialog" aria-modal="true" aria-label="Catálogo de objetos">
        <header className="catalog-modal-header"><h3>Catálogo de objetos</h3><div className="catalog-modal-header-actions"><input ref={importInput} type="file" accept=".tle,.txt,.json,.xml,.omm,.oem" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) action("import", { file }); event.target.value = ""; }} /><button className="catalog-header-btn" type="button" onClick={() => importInput.current?.click()}>Importar</button><button className="catalog-header-btn" type="button" onClick={() => action("filters")}>Filtros</button><button className="catalog-header-btn" type="button" onClick={() => action("refresh")}>Actualizar</button><button className="catalog-header-btn" type="button" onClick={() => action("select-all")}>Seleccionar todo</button><button className="catalog-close-btn" type="button" onClick={() => action("close")} aria-label="Cerrar">×</button></div></header>
        <input id="catalogSearch" type="search" placeholder="Buscar en el catálogo..." value={state.search || ""} onChange={(event) => action("search", { value: event.target.value })} />
        <div id="catalogList">{state.rows?.map((row) => <article className={`catalog-list-row${row.active ? " is-added" : ""}${row.selected ? " is-selected" : ""}`} key={row.id} onClick={(event) => action("toggle", { id: row.id, multi: event.ctrlKey || event.metaKey, range: event.shiftKey })}><div className="catalog-list-name">{row.orbit && <span className={`orbit-type-tag orbit-type-${row.orbitKind}`} title={row.orbit}>{row.orbit}</span>} {row.id} {row.format && <span className="catalog-format-badge">{row.format}</span>}</div><button className="catalog-row-action-btn" type="button" onClick={(event) => { event.stopPropagation(); action("info", { id: row.id }); }}>Info</button><span className={`catalog-row-state${row.active ? " is-added" : ""}`}>{row.active ? "Añadido" : "Disponible"}</span></article>)}</div>
        <footer className="catalog-modal-actions"><div className="catalog-progress">{state.busyText || `Mostrando ${state.rows?.length || 0} de ${state.total || 0}`}</div><div className="catalog-pagination"><button className="catalog-page-btn" type="button" disabled={state.page <= 1 || state.busy} onClick={() => action("page", { page: state.page - 1 })}>Anterior</button><span className="catalog-page-info">Página {state.page || 1}/{state.totalPages || 1}</span><button className="catalog-page-btn" type="button" disabled={state.page >= state.totalPages || state.busy} onClick={() => action("page", { page: state.page + 1 })}>Siguiente</button></div><button className="catalog-action-btn" type="button" disabled={!state.selected?.length || state.busy} onClick={() => action("include")}>Añadir seleccionadas</button></footer>
    </section></div>;
}

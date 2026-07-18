import { useEffect, useRef, useState } from "react";

export default function GlobalSearch() {
    const [query, setQuery] = useState("");
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [index, setIndex] = useState(0);
    const timer = useRef(null);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    const search = (value) => {
        setQuery(value);
        window.clearTimeout(timer.current);
        if (!value.trim()) { setItems([]); setOpen(false); return; }
        timer.current = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/catalog/page?${new URLSearchParams({ offset: "0", limit: "12", search: value.trim() })}`, { cache: "no-cache" });
                const data = await response.json();
                setItems((data?.items || []).map((item) => ({ name: String(item?.name || ""), noradId: item?.noradId || String(item?.line1 || "").slice(2, 7).trim() })).filter((item) => item.name));
                setIndex(0); setOpen(true);
            } catch { setItems([]); setOpen(true); }
        }, 120);
    };
    const select = (item) => { window.dispatchEvent(new CustomEvent("orbit:global-search-select", { detail: item })); setQuery(""); setOpen(false); };
    return <div className="toolbar-search-wrap"><span className="toolbar-search-icon" aria-hidden="true">&#8981;</span><input id="objectSearch" data-react-owned="true" className="toolbar-search" type="search" placeholder="Buscar satélite por nombre o NORAD..." autoComplete="off" spellCheck="false" value={query} onChange={(event) => search(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown" && items.length) { event.preventDefault(); setIndex((value) => (value + 1) % items.length); } if (event.key === "ArrowUp" && items.length) { event.preventDefault(); setIndex((value) => (value - 1 + items.length) % items.length); } if (event.key === "Enter" && query.trim()) { event.preventDefault(); select(items[index] || { name: query.trim() }); } if (event.key === "Escape") setOpen(false); }} />
        {open && <div id="topSearchSuggestions" className="open">{items.length ? items.map((item, itemIndex) => <button className={`toolbar-search-option${itemIndex === index ? " active" : ""}`} type="button" key={item.name} onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}><span className="toolbar-search-option-name">{item.name}</span><span className="toolbar-search-option-meta">{item.noradId ? `NORAD ${item.noradId}` : "Añadir capa"}</span></button>) : <div className="toolbar-search-empty">Sin resultados</div>}</div>}
    </div>;
}

import { useEffect, useRef, useState } from "react";

const optionClass = "toolbar-search-option !flex !items-center !justify-between !gap-2.5 !border-0 !border-b !border-[var(--orbit-border-primary)] !bg-transparent !px-2.5 !py-2 !text-left !font-[system-ui,sans-serif] !text-xs !leading-[1.25] !font-semibold !text-[var(--orbit-text-primary)] !cursor-pointer hover:!bg-[var(--orbit-bg-hover)] focus-visible:!relative focus-visible:!z-10 focus-visible:!outline-2 focus-visible:!outline-offset-[-2px] focus-visible:!outline-[var(--orbit-border-focus)]";

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
        if (!value.trim()) {
            setItems([]);
            setOpen(false);
            return;
        }

        timer.current = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/catalog/page?${new URLSearchParams({ offset: "0", limit: "12", search: value.trim() })}`, { cache: "no-cache" });
                const data = await response.json();
                setItems((data?.items || [])
                    .map((item) => ({ name: String(item?.name || ""), noradId: item?.noradId || String(item?.line1 || "").slice(2, 7).trim() }))
                    .filter((item) => item.name));
                setIndex(0);
                setOpen(true);
            } catch {
                setItems([]);
                setOpen(true);
            }
        }, 120);
    };

    const select = (item) => {
        window.dispatchEvent(new CustomEvent("orbit:global-search-select", { detail: item }));
        setQuery("");
        setOpen(false);
    };

    return <div className="toolbar-search-wrap !relative !flex !min-w-0 !items-center !w-[min(calc(370px*var(--orbit-ui-scale)),30vw)] !max-w-none max-[1100px]:!w-[min(290px,28vw)] max-[820px]:!flex-1 max-[820px]:!w-auto max-[620px]:!min-w-0 max-[620px]:!basis-[64px]">
        <span className="toolbar-search-icon !pointer-events-none !absolute !z-[1] !left-[11px] !text-[21px] !leading-none !text-[#a5b2c9] max-[620px]:!left-2 max-[620px]:!text-base" aria-hidden="true">⌕</span>
        <input
            id="objectSearch"
            data-react-owned="true"
            className="toolbar-search !box-border !h-[calc(38px*var(--orbit-ui-scale))] !w-full !min-w-0 !rounded-[calc(8px*var(--orbit-ui-scale))] !border !border-[#1a2a47] !bg-[#0a1221] !py-0 !pr-[10px] !pl-[calc(33px*var(--orbit-ui-scale))] !font-[system-ui,sans-serif] !text-[max(14px,calc(15px*var(--orbit-ui-scale)))] !leading-none !font-medium !text-[#d9e4ff] !outline-none !transition-[border-color,background] placeholder:!text-[var(--orbit-text-tertiary)] focus:!border-[var(--orbit-text-accent)] focus:!bg-[var(--orbit-bg-hover)] max-[620px]:!h-8 max-[620px]:!pl-[26px] max-[620px]:!text-xs"
            type="search"
            placeholder="Buscar satélite por nombre o NORAD..."
            autoComplete="off"
            spellCheck="false"
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === "ArrowDown" && items.length) {
                    event.preventDefault();
                    setIndex((value) => (value + 1) % items.length);
                }
                if (event.key === "ArrowUp" && items.length) {
                    event.preventDefault();
                    setIndex((value) => (value - 1 + items.length) % items.length);
                }
                if (event.key === "Enter" && query.trim()) {
                    event.preventDefault();
                    select(items[index] || { name: query.trim() });
                }
                if (event.key === "Escape") setOpen(false);
            }}
        />
        {open && <div id="topSearchSuggestions" className="open !absolute !top-[calc(100%+4px)] !right-0 !left-0 !z-[10120] !grid !max-h-[40vh] !overflow-y-auto !rounded-lg !border !border-[var(--orbit-border-secondary)] !bg-[var(--orbit-bg-modal)] !shadow-[0_14px_32px_rgba(0,0,0,.35)]">
            {items.length
                ? items.map((item, itemIndex) => <button
                    className={`${optionClass}${itemIndex === index ? " active !bg-[var(--orbit-bg-hover)]" : ""}`}
                    type="button"
                    key={`${item.name}-${item.noradId || itemIndex}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(item)}
                >
                    <span className="toolbar-search-option-name !min-w-0 !overflow-hidden !text-ellipsis !whitespace-nowrap !text-[var(--orbit-text-primary)]">{item.name}</span>
                    <span className="toolbar-search-option-meta !shrink-0 !text-[11px] !font-medium !text-[var(--orbit-text-tertiary)]">{item.noradId ? `NORAD ${item.noradId}` : "Añadir capa"}</span>
                </button>)
                : <div className="toolbar-search-empty !flex !items-center !justify-center !border-0 !border-b !border-[var(--orbit-border-primary)] !bg-transparent !px-2.5 !py-2 !font-[system-ui,sans-serif] !text-xs !leading-[1.25] !font-semibold !text-[var(--orbit-text-tertiary)]">Sin resultados</div>}
        </div>}
    </div>;
}

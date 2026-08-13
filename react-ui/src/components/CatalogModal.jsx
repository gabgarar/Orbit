import { useEffect, useState } from "react";
import { formatCatalogRefreshCountdown } from "../../../front/js/features/catalog/refreshStatus.js";
import PanelCloseButton from "./PanelCloseButton.jsx";

const action = (type, detail = {}) => window.dispatchEvent(new CustomEvent("orbit:catalog-action", { detail: { type, ...detail } }));

const headerButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2.5 py-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)] disabled:cursor-not-allowed disabled:opacity-45";
const pageButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-tertiary)] px-2.5 py-1.5 font-[system-ui,sans-serif] text-xs font-bold text-[var(--orbit-text-primary)] hover:border-[var(--orbit-border-focus)] hover:bg-[var(--orbit-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50 max-[480px]:px-[7px]";
const actionButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2 py-[7px] font-[system-ui,sans-serif] text-[11px] font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)] disabled:cursor-not-allowed disabled:opacity-45";
// Warning and Info intentionally share this exact outer box. Keeping their
// dimensions in one class prevents a browser/default-button style from making
// the warning column visually drift from the action beside it.
const catalogInlineControlClass = "inline-flex !box-border !h-[22px] !w-[34px] shrink-0 items-center justify-center !rounded-[5px] !p-0";
const catalogInfoButtonClass = `${catalogInlineControlClass} cursor-pointer border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] font-[system-ui,sans-serif] !text-[10px] !leading-4 font-bold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]`;
const catalogRowClass = (row) => [
    "grid !min-h-[30px] cursor-pointer select-none grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center !gap-1.5 border-b border-[var(--orbit-border-primary)] px-2 !py-0.5",
    row.selected ? "bg-[var(--orbit-bg-active)] hover:bg-[var(--orbit-bg-active)]" : "hover:bg-[var(--orbit-bg-hover)]",
    row.active && "cursor-default opacity-80"
].filter(Boolean).join(" ");
const orbitTagBackground = {
    leo: "bg-[#d77d00]",
    meo: "bg-[#1f9d63]",
    geo: "bg-[#2d7fc9]",
    heo: "bg-[#7a4fbf]",
    unknown: "bg-[#7f8c8d]"
};

const emptyRefreshState = Object.freeze({ status: "idle", message: "", detail: "", progress: 0, retryAt: null });

function normalizeRefreshState(value) {
    const retryAt = Number(value?.retryAt);
    return {
        status: String(value?.status || "idle"),
        message: String(value?.message || ""),
        detail: String(value?.detail || ""),
        progress: Math.max(0, Math.min(100, Number(value?.progress) || 0)),
        retryAt: Number.isFinite(retryAt) && retryAt > 0 ? retryAt : null
    };
}

function CatalogRefreshStatus({ refresh, now }) {
    if (refresh.status === "idle") return null;

    const isPending = refresh.status === "pending";
    const isLimited = refresh.status === "rate-limited";
    const tone = isPending
        ? "border-[#395f9c] bg-[#10213c] text-[#d8e8ff]"
        : isLimited
            ? "border-[#9d6c23] bg-[#302411] text-[#ffe0a1]"
            : refresh.status === "success"
                ? "border-[#2e8760] bg-[#0d2a20] text-[#c4f3db]"
                : "border-[#a14658] bg-[#301922] text-[#ffd0d8]";
    const countdown = isLimited ? formatCatalogRefreshCountdown(refresh.retryAt, now) : "";
    const message = isLimited
        ? countdown === "ahora"
            ? "Ya puedes volver a actualizar el catálogo."
            : `Podrás volver a actualizar en ${countdown}.`
        : refresh.message;

    return <section data-testid="catalog-refresh-status" className={`grid gap-1.5 rounded-lg border px-2.5 py-2 font-[system-ui,sans-serif] text-[11px] leading-[1.35] ${tone}`} role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
            <strong className="text-xs">{refresh.message || "Estado de actualización"}</strong>
            {isPending && <span className="shrink-0 font-semibold tabular-nums">{Math.round(refresh.progress)}%</span>}
        </div>
        {isPending && <div className="h-1.5 overflow-hidden rounded-full bg-black/25" role="progressbar" aria-label="Progreso de actualización" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(refresh.progress)}><div className="h-full rounded-full bg-[#70adff] transition-[width] duration-200" style={{ width: `${refresh.progress}%` }} /></div>}
        {message && <p className="m-0">{message}</p>}
        {refresh.detail && refresh.detail !== refresh.message && <p className="m-0 text-[10px] opacity-85">{refresh.detail}</p>}
    </section>;
}

function TleFreshnessWarning({ warning, message }) {
    const text = message || "TLE fuera de su ventana de precisión recomendada.";
    return <span
        className={`${catalogInlineControlClass} border border-[#9d6c23] bg-[#3a2a12] text-[#ffd276] shadow-[inset_0_1px_0_rgba(255,210,118,.08)] ${warning ? "" : "invisible"}`}
        title={warning ? text : undefined}
        aria-label={warning ? text : undefined}
        aria-hidden={warning ? undefined : true}
    >
        <svg className="!size-3 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
    </span>;
}

export default function CatalogModal() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState({ rows: [], page: 1, totalPages: 1, total: 0, selectedCount: 0, filters: {} });
    const [searchValue, setSearchValue] = useState("");
    const [refresh, setRefresh] = useState(emptyRefreshState);
    const [refreshClock, setRefreshClock] = useState(Date.now());

    useEffect(() => {
        const onOpen = () => setOpen(true);
        const onClose = () => setOpen(false);
        const onState = (event) => {
            const next = event.detail || {};
            setState(next);
            if (next.refresh) setRefresh(normalizeRefreshState(next.refresh));
        };
        const onRefreshState = (event) => setRefresh(normalizeRefreshState(event.detail));
        window.addEventListener("orbit:catalog-open", onOpen);
        window.addEventListener("orbit:catalog-close", onClose);
        window.addEventListener("orbit:catalog-state", onState);
        window.addEventListener("orbit:catalog-refresh-state", onRefreshState);
        return () => {
            window.removeEventListener("orbit:catalog-open", onOpen);
            window.removeEventListener("orbit:catalog-close", onClose);
            window.removeEventListener("orbit:catalog-state", onState);
            window.removeEventListener("orbit:catalog-refresh-state", onRefreshState);
        };
    }, []);

    useEffect(() => {
        setRefreshClock(Date.now());
        if (!refresh.retryAt || refresh.retryAt <= Date.now()) return undefined;
        const timer = window.setInterval(() => setRefreshClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [refresh.retryAt]);

    useEffect(() => {
        setSearchValue(state.search || "");
    }, [state.search]);

    useEffect(() => {
        if (!open || searchValue === (state.search || "")) {
            return undefined;
        }

        const timeout = window.setTimeout(() => action("search", { value: searchValue }), 280);
        return () => window.clearTimeout(timeout);
    }, [open, searchValue, state.search]);

    if (!open) return null;

    const headerBusy = state.busy === true;
    const refreshBlocked = headerBusy || (refresh.status === "rate-limited" && Number(refresh.retryAt) > refreshClock);
    const refreshTitle = refreshBlocked && refresh.status === "rate-limited"
        ? `Disponible en ${formatCatalogRefreshCountdown(refresh.retryAt, refreshClock)}`
        : "Actualizar catálogo";

    return <div id="catalogModal" data-testid="catalog-modal" className="fixed inset-0 z-[10120] !flex items-center justify-center overflow-hidden bg-[var(--orbit-bg-overlay)] p-4 max-[760px]:!items-start max-[760px]:!p-2 max-[480px]:!p-[6px]" onMouseDown={(event) => event.target === event.currentTarget && !headerBusy && action("close")}>
        <section className="grid w-[min(680px,calc(100vw-32px))] max-h-[88vh] gap-2 overflow-hidden rounded-[calc(12px*var(--orbit-ui-scale))] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-secondary)] p-[calc(12px*var(--orbit-ui-scale))] text-[var(--orbit-text-primary)] shadow-[0_20px_60px_rgba(0,0,0,.4)] max-[760px]:w-[min(620px,calc(100vw-16px))] max-[760px]:max-h-[calc(100dvh-16px)] max-[760px]:m-auto max-[760px]:gap-[6px] max-[760px]:p-2 max-[480px]:w-[calc(100vw-12px)] max-[480px]:max-h-[calc(100dvh-12px)] max-[480px]:p-2" role="dialog" aria-modal="true" aria-label="Catálogo de objetos">
            <header className="flex items-center justify-between max-[760px]:grid max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:items-start max-[760px]:gap-2">
                <h3 className="m-0 font-[system-ui,sans-serif] text-sm font-bold max-[760px]:pt-[7px]">Catálogo de objetos</h3>
                <div className="inline-flex flex-none flex-nowrap items-center gap-2 max-[760px]:grid max-[760px]:grid-cols-[repeat(2,minmax(74px,1fr))_34px] max-[760px]:gap-[5px] max-[480px]:grid-cols-[repeat(2,minmax(66px,1fr))_32px]">
                    <button data-testid="catalog-filters" className={headerButtonClass} type="button" disabled={headerBusy} onClick={() => action("filters")}>Filtros</button>
                    <button data-testid="catalog-refresh" className={headerButtonClass} type="button" disabled={refreshBlocked} title={refreshTitle} onClick={() => action("refresh")}>Actualizar</button>
                    <button data-testid="catalog-select-all" className={headerButtonClass} type="button" disabled={headerBusy} onClick={() => action("select-all")}>Seleccionar todo</button>
                    <PanelCloseButton className="max-[760px]:col-start-3 max-[760px]:row-start-1 max-[760px]:justify-self-center disabled:cursor-not-allowed disabled:opacity-45" disabled={headerBusy} onClick={() => action("close")} />
                </div>
            </header>
            <CatalogRefreshStatus refresh={refresh} now={refreshClock} />
            <input id="catalogSearch" className="!rounded-lg !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-input)] !px-2 !py-[7px] !font-[system-ui,sans-serif] !text-xs !text-[var(--orbit-text-primary)] disabled:!cursor-not-allowed disabled:!opacity-45" type="search" disabled={headerBusy} placeholder="Buscar en el catálogo..." value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
            <div id="catalogList" data-testid="catalog-list" className="!max-h-[62vh] !overflow-auto !rounded-[10px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-elevated)] [scrollbar-color:var(--orbit-scrollbar-thumb)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-md [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--orbit-scrollbar-thumb)] [&::-webkit-scrollbar-thumb]:bg-clip-padding hover:[&::-webkit-scrollbar-thumb]:bg-[var(--orbit-scrollbar-thumb-end)] [&>article>.catalog-state-badge]:!px-1.5 [&>article>.catalog-state-badge]:!py-0.5 [&>article>.catalog-state-badge]:!text-[10px] [&>article>.catalog-state-badge]:!leading-4">
                {state.rows?.map((row) => <article data-testid="catalog-row" className={catalogRowClass(row)} key={row.id} aria-selected={row.selected ? "true" : "false"} onClick={(event) => action("toggle", { id: row.id, multi: event.ctrlKey || event.metaKey, range: event.shiftKey })}>
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap font-[system-ui,sans-serif] !text-[11px] !leading-4 text-[var(--orbit-text-primary)] max-[480px]:!text-[10px]">{row.orbit && <span className={`!mr-1 inline-flex items-center justify-center rounded-[4px] border border-white/25 !px-1 !py-0 align-middle font-mono !text-[9px] leading-[1.4] font-bold tracking-[.02em] text-[#f4f8ff] max-[480px]:!mr-[3px] ${orbitTagBackground[row.orbitKind] || orbitTagBackground.unknown}`} title={row.orbit}>{row.orbit}</span>} {row.id} {row.format && <span className="inline-flex !min-w-7 items-center justify-center rounded-full border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-active)] !px-1 !py-0 font-[system-ui,sans-serif] !text-[9px] leading-[1.2] font-bold tracking-[.3px] text-[var(--orbit-text-accent)]">{row.format}</span>}</div>
                    <TleFreshnessWarning warning={row.tleAgeWarning === true} message={row.tleFreshnessMessage} />
                    <button className={catalogInfoButtonClass} type="button" onClick={(event) => { event.stopPropagation(); action("info", { id: row.id }); }}>Info</button>
                    <span className={`catalog-state-badge rounded-full border border-[var(--orbit-border-primary)] px-2 py-[3px] font-[system-ui,sans-serif] text-[11px] font-semibold text-[var(--orbit-text-tertiary)] max-[480px]:text-[10px]${row.active ? " border-[var(--orbit-border-focus)] bg-[var(--orbit-bg-selected)] text-[var(--orbit-text-accent)]" : ""}`}>{row.active ? "Añadido" : "Disponible"}</span>
                </article>)}
            </div>
            <footer className="sticky bottom-0 grid grid-cols-1 gap-2 bg-[linear-gradient(180deg,transparent_0%,var(--orbit-bg-secondary)_24%)] pt-2">
                <div className="min-h-4 font-[system-ui,sans-serif] text-[11px] font-semibold text-[var(--orbit-text-tertiary)]">{state.busyText || `Mostrando ${state.rows?.length || 0} de ${state.total || 0}`}</div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 max-[480px]:gap-1">
                    <button data-testid="catalog-page-prev" className={pageButtonClass} type="button" disabled={state.page <= 1 || state.busy} onClick={() => action("page", { page: state.page - 1 })}>Anterior</button>
                    <span className="text-center font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-tertiary)]">Página {state.page || 1}/{state.totalPages || 1}</span>
                    <button data-testid="catalog-page-next" className={pageButtonClass} type="button" disabled={state.page >= state.totalPages || state.busy} onClick={() => action("page", { page: state.page + 1 })}>Siguiente</button>
                </div>
                <button className={actionButtonClass} type="button" disabled={!state.selectedCount || state.busy} onClick={() => action("include")}>Añadir seleccionadas</button>
            </footer>
        </section>
    </div>;
}

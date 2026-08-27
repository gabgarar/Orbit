import { useEffect } from "react";
import PanelCloseButton from "../PanelCloseButton.jsx";
import { requestOperationCancel } from "../../../../front/js/features/operations/operationsContract.js";

const scopeLabels = Object.freeze({
    "manual-orbit": "Diseño de órbita",
    "orbit-design": "Diseño de órbita",
    scene: "Escena",
    project: "Proyecto",
    system: "Sistema"
});

function scopeLabel(scope) {
    return scopeLabels[scope] || scope || "Operación";
}

function progressText(progress) {
    return progress === null || progress === undefined ? "En curso" : `${Math.round(progress)} %`;
}

function statusLabel(status) {
    return status === "queued" ? "En cola" : "En curso";
}

function OperationItem({ operation }) {
    const hasProgress = operation.progress !== null && operation.progress !== undefined;
    return <article className="orbit-operation-card rounded-[6px] border border-[#294767] bg-[#09172a] px-3 py-2.5 text-[#dce8fb]">
        <div className="flex min-w-0 items-start gap-2">
            <span className="orbit-operation-activity-dot mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-[#70a1ff] shadow-[0_0_8px_rgba(91,142,255,.92)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start gap-2">
                    <strong className="orbit-operation-title min-w-0 flex-1 text-[12px] leading-[1.25] font-semibold text-[#edf5ff]">{operation.title}</strong>
                    <span className="orbit-operation-scope-chip shrink-0 rounded-full border border-[#375c89] bg-[#102744] px-1.5 py-0.5 text-[9px] leading-none font-semibold text-[#a9c8ff]">{scopeLabel(operation.scope)}</span>
                </div>
                <div className="orbit-operation-status-row mt-1 flex items-center gap-1.5 text-[10px] leading-none text-[#8fa9cf]"><span className="orbit-operation-status-chip rounded-full border border-[#315171] bg-[#0e2239] px-1.5 py-0.5 font-semibold text-[#b4cef7]">{statusLabel(operation.status)}</span>{operation.stage ? <span className="min-w-0 truncate">{operation.stage}</span> : null}</div>
                {operation.message ? <p className="mt-1 mb-0 text-[10px] leading-snug text-[#8fa7c9]">{operation.message}</p> : null}
                <div className="orbit-operation-progress-row mt-2 flex items-center gap-2">
                    <div className="orbit-operation-progress-track h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#172842]" aria-label={`Progreso: ${progressText(operation.progress)}`}>
                        <div className={`orbit-operation-progress-fill h-full rounded-full bg-[#5b8eff] transition-[width] duration-200 ${hasProgress ? "" : "w-2/5 animate-pulse"}`} style={hasProgress ? { width: `${operation.progress}%` } : undefined} />
                    </div>
                    <span className="shrink-0 text-[10px] leading-none font-semibold tabular-nums text-[#a9c5f5]">{progressText(operation.progress)}</span>
                    {operation.cancellable ? <button className="orbit-operation-cancel shrink-0 cursor-pointer rounded-[5px] border border-[#71505b] bg-[#291923] px-1.5 py-1 text-[9px] leading-none font-semibold text-[#ffc4ca] transition-colors hover:border-[#af6673] hover:bg-[#3a202c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fa7ff]" type="button" onClick={() => requestOperationCancel({ id: operation.id, scope: operation.scope })}>Cancelar</button> : null}
                </div>
            </div>
        </div>
    </article>;
}

/** A non-modal popover: status is visible without interrupting the work it
 * describes.  It owns no operation state and is safe to close at any time. */
export default function OperationsPanel({ operations, onClose }) {
    useEffect(() => {
        const closeOnEscape = (event) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);

    return <section
        id="orbitOperationsPanel"
        className="orbit-operations-panel orbit-scrollbar fixed top-[calc(max(64px,calc(76px*var(--orbit-ui-scale)))+10px)] right-[clamp(10px,1.7vw,28px)] z-[10520] max-h-[min(520px,calc(100vh-max(64px,calc(76px*var(--orbit-ui-scale)))-26px))] w-[min(440px,calc(100vw-20px))] overflow-y-auto rounded-[10px] border border-[#38577f] bg-[#091628]/[.98] text-[#dce8fb] shadow-[0_22px_60px_rgba(0,0,0,.58)] backdrop-blur-[8px]"
        role="dialog"
        aria-modal="false"
        aria-labelledby="orbitOperationsTitle"
    >
        <header className="orbit-operations-panel__header sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#27415f] px-3 py-2.5">
            <div className="min-w-0">
                <span className="block text-[9px] leading-none font-bold tracking-[.15em] text-[#7198e6]">ORBIT · ACTIVIDAD</span>
                <h2 id="orbitOperationsTitle" className="mt-1 mb-0 text-[15px] leading-none font-semibold text-[#edf5ff]">Operaciones en curso</h2>
            </div>
            <PanelCloseButton label="Cerrar operaciones" onClick={onClose} />
        </header>
        <div className="orbit-operations-panel__content p-3">
            {operations.length ? <div className="grid gap-2" aria-live="polite" aria-relevant="additions text">
                {operations.map((operation) => <OperationItem key={operation.id} operation={operation} />)}
            </div> : <p className="orbit-operations-panel__empty m-0 rounded-[6px] border border-[#294667] bg-[#0d2038] px-3 py-3 text-[11px] leading-snug text-[#afc1dc]">No hay operaciones activas.</p>}
        </div>
    </section>;
}

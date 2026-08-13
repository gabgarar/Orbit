import { useCallback, useEffect, useRef, useState } from "react";
import PanelCloseButton from "./PanelCloseButton.jsx";
import {
    MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT,
    MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT,
    MASTER_TIME_RANGE_DIALOG_READY_KEY,
    MASTER_TIME_RANGE_PENDING_REQUESTS_KEY,
    createMasterTimeRangeExpansionRequest,
    formatMasterTimeRangeUtc
} from "../../../front/js/features/masterTimeRange/ui.js";

const buttonClass = "!inline-flex !min-h-[36px] !items-center !justify-center !rounded-[8px] !border !px-3 !font-sans !text-xs !font-semibold !cursor-pointer focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]";

/**
 * The single visible confirmation point for all MTR expansions.
 *
 * Consumers dispatch `orbit:master-time-range-expand-request` or use
 * `requestMasterTimeRangeExpansion()` from the UI contract.  Responses carry
 * `{ id, decision: "expand" | "cancel", accepted }`, so non-React importers
 * never need a direct dependency on this component.
 */
export default function MasterTimeRangeDialog() {
    const [queue, setQueue] = useState([]);
    const expandButtonRef = useRef(null);
    // DOM events can be delivered twice (double click, Enter followed by a
    // click, or an overlay pointer sequence) before React commits the queue
    // update. Keep the response edge-triggered so an external listener never
    // observes both an expand and a cancel for the same MTR request.
    const respondingRequestIdRef = useRef(null);
    const request = queue[0] || null;

    const respond = useCallback((decision) => {
        if (!request || respondingRequestIdRef.current === request.id) return;
        respondingRequestIdRef.current = request.id;
        const accepted = decision === "expand";
        window.dispatchEvent(new CustomEvent(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, {
            detail: { id: request.id, decision: accepted ? "expand" : "cancel", accepted }
        }));
        setQueue((pending) => pending.filter((item) => item.id !== request.id));
    }, [request]);

    useEffect(() => {
        // Once React has advanced to the next queued item, allow exactly one
        // answer for that item. The ref intentionally remains set while the
        // old request is still rendered between event handlers.
        if (!request || respondingRequestIdRef.current !== request.id) {
            respondingRequestIdRef.current = null;
        }
    }, [request]);

    useEffect(() => {
        const onRequest = (event) => {
            const next = createMasterTimeRangeExpansionRequest(event.detail);
            setQueue((pending) => pending.some((item) => item.id === next.id) ? pending : [...pending, next]);
        };
        window.addEventListener(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, onRequest);
        window[MASTER_TIME_RANGE_DIALOG_READY_KEY] = true;
        const pending = Array.isArray(window[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY])
            ? window[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY].splice(0)
            : [];
        pending.forEach((detail) => onRequest({ detail }));
        return () => {
            window.removeEventListener(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, onRequest);
            window[MASTER_TIME_RANGE_DIALOG_READY_KEY] = false;
        };
    }, []);

    useEffect(() => {
        if (!request) return undefined;
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            respond("cancel");
        };
        document.addEventListener("keydown", onKeyDown);
        window.requestAnimationFrame(() => expandButtonRef.current?.focus?.({ preventScroll: true }));
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [request, respond]);

    if (!request) return null;

    const rangeText = formatMasterTimeRangeUtc(request.range);
    const masterRangeText = formatMasterTimeRangeUtc(request.masterRange);
    const descriptionId = "masterTimeRangeDialogMessage";

    return <div
        id="masterTimeRangeDialog"
        className="!fixed !inset-0 !z-[10160] !flex !items-center !justify-center !bg-[var(--orbit-bg-overlay)] !p-4 !box-border"
        onMouseDown={(event) => event.target === event.currentTarget && respond("cancel")}
    >
        <section
            id="masterTimeRangeDialogPanel"
            className="!relative !grid !w-[min(520px,94vw)] !gap-3 !rounded-[var(--orbit-radius-window)] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-secondary)] !p-4 !text-[var(--orbit-text-primary)] !shadow-[0_20px_60px_rgba(0,0,0,.52)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="masterTimeRangeDialogTitle"
            aria-describedby={descriptionId}
        >
            <PanelCloseButton className="!absolute !top-3 !right-3" label="Cancelar ampliación del rango temporal maestro" onClick={() => respond("cancel")} />
            <header className="!min-w-0 !pr-8">
                <h2 id="masterTimeRangeDialogTitle" className="!m-0 !font-sans !text-[15px] !leading-tight !font-semibold">{request.title}</h2>
                {request.objectName && <p className="!mt-1 !mb-0 !font-sans !text-[11px] !leading-[1.4] !text-[var(--orbit-text-secondary)]">Objeto: <strong className="!font-semibold !text-[var(--orbit-text-primary)]">{request.objectName}</strong></p>}
            </header>
            <p id={descriptionId} className="!m-0 !font-sans !text-[13px] !leading-[1.48] !text-[var(--orbit-text-primary)]">{request.message}</p>
            {(rangeText || masterRangeText) && <dl className="!m-0 !grid !gap-1.5 !rounded-[8px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-tertiary)] !px-3 !py-2.5 !font-sans !text-[11px] !leading-[1.42]">
                {masterRangeText && <div className="!grid !grid-cols-[minmax(112px,auto)_1fr] !gap-2"><dt className="!font-medium !text-[var(--orbit-text-secondary)]">Rango actual</dt><dd className="!m-0 !break-words !text-[var(--orbit-text-primary)]">{masterRangeText}</dd></div>}
                {rangeText && <div className="!grid !grid-cols-[minmax(112px,auto)_1fr] !gap-2"><dt className="!font-medium !text-[var(--orbit-text-secondary)]">Rango del objeto</dt><dd className="!m-0 !break-words !text-[var(--orbit-text-primary)]">{rangeText}</dd></div>}
            </dl>}
            <div className="!flex !justify-end !gap-2 !pt-1">
                <button className={`${buttonClass} !border-[var(--orbit-border-accent)] !bg-[var(--orbit-bg-tertiary)] !text-[var(--orbit-text-primary)] hover:!bg-[var(--orbit-bg-hover)]`} type="button" onClick={() => respond("cancel")}>{request.cancelLabel}</button>
                <button ref={expandButtonRef} className={`${buttonClass} !border-[var(--orbit-border-focus)] !bg-[var(--orbit-bg-active)] !text-[var(--orbit-text-primary)] hover:!bg-[var(--orbit-bg-hover)]`} type="button" onClick={() => respond("expand")}>{request.expandLabel}</button>
            </div>
        </section>
    </div>;
}

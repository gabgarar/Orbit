import { useCallback, useEffect, useRef, useState } from "react";
import PanelCloseButton from "./PanelCloseButton.jsx";
import { PRECISE_PRODUCT_VALIDATION_DIALOG_EVENT } from "../../../front/js/features/preciseProducts/validationUi.js";

function normalizedRequest(value) {
    if (!value || typeof value !== "object") return null;
    const message = String(value.message || "").trim();
    if (!message) return null;
    return {
        id: String(value.id || `precise-product-validation-${Date.now()}`),
        title: String(value.title || "Validación del producto GNSS"),
        message,
        details: Array.isArray(value.details)
            ? value.details.map((detail) => String(detail || "").trim()).filter(Boolean)
            : [],
        acknowledgeLabel: String(value.acknowledgeLabel || "Aceptar"),
        focusId: String(value.focusId || "")
    };
}

/**
 * A blocking acknowledgement for SP3/ERP safety checks.
 *
 * It intentionally remains separate from notifications: a validation error
 * has stopped an operation and must be visible before the operator can try to
 * continue the import flow.  The file/selection modal is left in place below
 * this dialog so a dismissal returns to exactly the same work in progress.
 */
export default function PreciseProductValidationDialog() {
    const [request, setRequest] = useState(null);
    const acknowledgeRef = useRef(null);

    const dismiss = useCallback(() => {
        if (!request) return;
        const { focusId } = request;
        setRequest(null);
        window.requestAnimationFrame(() => {
            document.getElementById(focusId)?.focus?.({ preventScroll: true });
        });
    }, [request]);

    useEffect(() => {
        const onRequest = (event) => setRequest(normalizedRequest(event.detail));
        window.addEventListener(PRECISE_PRODUCT_VALIDATION_DIALOG_EVENT, onRequest);
        return () => window.removeEventListener(PRECISE_PRODUCT_VALIDATION_DIALOG_EVENT, onRequest);
    }, []);

    useEffect(() => {
        if (!request) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                dismiss();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        window.requestAnimationFrame(() => acknowledgeRef.current?.focus?.({ preventScroll: true }));
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [dismiss, request]);

    if (!request) return null;

    return <div
        id="preciseProductValidationDialog"
        className="!fixed !inset-0 !z-[10150] !flex !items-center !justify-center !bg-[var(--orbit-bg-overlay)] !p-4 !box-border"
        onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
    >
        <section
            className="!relative !grid !w-[min(510px,94vw)] !gap-3 !rounded-[var(--orbit-radius-window)] !border !border-[var(--orbit-border-danger)] !bg-[var(--orbit-bg-secondary)] !p-4 !text-[var(--orbit-text-primary)] !shadow-[0_20px_60px_rgba(0,0,0,.52)]"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="preciseProductValidationDialogTitle"
            aria-describedby="preciseProductValidationDialogMessage"
        >
            <PanelCloseButton className="!absolute !top-3 !right-3" label="Cerrar aviso de validación" onClick={dismiss} />
            <header className="!flex !min-w-0 !items-center !gap-2 !pr-8">
                <span className="!grid !size-7 !shrink-0 !place-items-center !rounded-full !border !border-[var(--orbit-border-danger)] !bg-[var(--orbit-bg-danger-soft)] !text-sm !font-bold !text-[var(--orbit-text-danger-soft)]" aria-hidden="true">!</span>
                <h2 id="preciseProductValidationDialogTitle" className="!m-0 !min-w-0 !font-sans !text-[15px] !leading-tight !font-semibold">{request.title}</h2>
            </header>
            <p id="preciseProductValidationDialogMessage" className="!m-0 !whitespace-pre-wrap !font-sans !text-[13px] !leading-[1.48] !text-[var(--orbit-text-primary)]">{request.message}</p>
            {request.details.length > 0 && <ul className="!m-0 !grid !gap-1 !pl-5 !font-sans !text-[11px] !leading-[1.45] !text-[var(--orbit-text-secondary)]">
                {request.details.map((detail) => <li key={detail}>{detail}</li>)}
            </ul>}
            <div className="!flex !justify-end !pt-1">
                <button
                    ref={acknowledgeRef}
                    className="!min-h-[34px] !cursor-pointer !rounded-[9px] !border !border-[var(--orbit-border-focus)] !bg-[var(--orbit-bg-active)] !px-3 !font-sans !text-xs !font-semibold !text-[var(--orbit-text-primary)] hover:!bg-[var(--orbit-bg-hover)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]"
                    type="button"
                    onClick={dismiss}
                >
                    {request.acknowledgeLabel}
                </button>
            </div>
        </section>
    </div>;
}

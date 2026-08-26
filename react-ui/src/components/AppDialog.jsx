import { useEffect, useState } from "react";
import PanelCloseButton from "./PanelCloseButton.jsx";

const buttonClass = "!inline-flex !h-[34px] !items-center !justify-center !rounded-[10px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-tertiary)] !px-3 !text-xs !leading-none !font-bold !text-[var(--orbit-text-primary)] !cursor-pointer hover:!bg-[var(--orbit-bg-hover)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]";

export default function AppDialog() {
    const [dialog, setDialog] = useState(null);

    const respond = (accepted) => {
        if (dialog) {
            window.dispatchEvent(new CustomEvent("orbit:app-dialog-response", {
                detail: { id: dialog.id, accepted }
            }));
        }
        setDialog(null);
    };

    useEffect(() => {
        const open = (event) => setDialog(event.detail);
        window.addEventListener("orbit:app-dialog-request", open);
        return () => window.removeEventListener("orbit:app-dialog-request", open);
    }, []);

    useEffect(() => {
        const onKey = (event) => event.key === "Escape" && respond(false);
        if (dialog) document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [dialog]);

    if (!dialog) return null;

    // Global alerts must remain above floating inspectors, which reserve a
    // near-maximum z-index to sit above the Cesium workspace.
    return <div
        id="appDialogModal"
        className="open !fixed !inset-0 !z-[2147483646] !flex !items-center !justify-center !bg-[var(--orbit-bg-overlay)] !p-[14px] !box-border"
        onMouseDown={(event) => event.target === event.currentTarget && respond(false)}
    >
        <section
            id="appDialogPanel"
            className="!relative !w-[min(420px,94vw)] !rounded-[14px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-secondary)] !p-4 !text-[var(--orbit-text-primary)] !shadow-[0_16px_40px_rgba(0,0,0,.45)]"
            role="dialog"
            aria-modal="true"
        >
            <PanelCloseButton className="!absolute !top-3 !right-3" label="Cerrar diálogo" onClick={() => respond(false)} />
            <h4 className="!m-0 !mb-2 !pr-8 !font-sans !text-base !leading-none !font-bold">{dialog.title}</h4>
            <p className="!m-0 !font-sans !text-[13px] !leading-[1.45] !text-[var(--orbit-text-secondary)]">{dialog.message}</p>
            <div id="appDialogActions" className="!mt-4 !flex !justify-end !gap-2">
                {dialog.showCancel && <button className={buttonClass} type="button" onClick={() => respond(false)}>Cancelar</button>}
                <button
                    className={`${buttonClass} !border-[var(--orbit-border-success)] !bg-[var(--orbit-bg-success-soft)] hover:!bg-[var(--orbit-bg-success-soft-hover)]`}
                    type="button"
                    onClick={() => respond(true)}
                >
                    {dialog.confirmLabel || "Aceptar"}
                </button>
            </div>
        </section>
    </div>;
}

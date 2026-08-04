import { useEffect, useState } from "react";

const buttonClass = "!min-h-[38px] !rounded-[10px] !border !border-[var(--orbit-border-accent)] !bg-[var(--orbit-bg-tertiary)] !px-3 !font-sans !text-xs !font-semibold !text-[var(--orbit-text-primary)] !cursor-pointer hover:!bg-[var(--orbit-bg-hover)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]";

export default function ConfirmDialog() {
    const [request, setRequest] = useState(null);

    const respond = (accepted) => {
        if (!request) return;
        window.dispatchEvent(new CustomEvent("orbit:confirm-response", {
            detail: { id: request.id, accepted }
        }));
        setRequest(null);
    };

    useEffect(() => {
        const onRequest = (event) => setRequest(event.detail || null);
        window.addEventListener("orbit:confirm-request", onRequest);
        return () => window.removeEventListener("orbit:confirm-request", onRequest);
    }, []);

    useEffect(() => {
        if (!request) return undefined;
        const onEscape = (event) => event.key === "Escape" && respond(false);
        document.addEventListener("keydown", onEscape);
        return () => document.removeEventListener("keydown", onEscape);
    }, [request]);

    if (!request) return null;

    return <div
        id="sidebarConfirmModal"
        className="open !fixed !inset-0 !z-[10140] !flex !items-center !justify-center !bg-[var(--orbit-bg-overlay)] !p-4 !box-border"
        onMouseDown={(event) => event.target === event.currentTarget && respond(false)}
    >
        <section
            className="!grid !w-[min(460px,94vw)] !gap-3 !rounded-[14px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-secondary)] !p-4 !text-[var(--orbit-text-primary)] !shadow-[0_20px_60px_rgba(0,0,0,.45)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sidebarConfirmTitle"
        >
            <h3 id="sidebarConfirmTitle" className="!m-0 !font-sans !text-base !leading-none !font-bold">{request.title}</h3>
            <p id="sidebarConfirmMessage" className="!m-0 !font-sans !text-[13px] !leading-[1.45] !text-[var(--orbit-text-secondary)]">{request.message}</p>
            <div className="!grid !grid-cols-2 !gap-2">
                <button className={buttonClass} type="button" onClick={() => respond(false)}>{request.cancelText || "Cancelar"}</button>
                <button className={`${buttonClass} !border-[var(--orbit-border-focus)] !bg-[var(--orbit-bg-active)]`} type="button" onClick={() => respond(true)}>{request.confirmText || "Aceptar"}</button>
            </div>
        </section>
    </div>;
}

import { useEffect, useState } from "react";

export default function ConfirmDialog() {
    const [request, setRequest] = useState(null);
    const respond = (accepted) => {
        if (!request) return;
        window.dispatchEvent(new CustomEvent("orbit:confirm-response", { detail: { id: request.id, accepted } }));
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
    return <div id="sidebarConfirmModal" className="open" onMouseDown={(event) => event.target === event.currentTarget && respond(false)}><section className="sidebar-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="sidebarConfirmTitle">
        <h3 id="sidebarConfirmTitle">{request.title}</h3><p id="sidebarConfirmMessage">{request.message}</p>
        <div className="sidebar-confirm-actions"><button className="sidebar-confirm-btn secondary" type="button" onClick={() => respond(false)}>{request.cancelText || "Cancelar"}</button><button className="sidebar-confirm-btn" type="button" onClick={() => respond(true)}>{request.confirmText || "Aceptar"}</button></div>
    </section></div>;
}

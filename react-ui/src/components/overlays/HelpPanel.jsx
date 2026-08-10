import { useEffect } from "react";
import PanelCloseButton from "../PanelCloseButton.jsx";

const localDocumentationUrl = "/Orbit/";
const publicDocumentationUrl = "https://gabgarar.github.io/Orbit/";
const actionClass = "inline-flex h-8 items-center justify-center rounded-[7px] border border-[#36577f] bg-[#102039] px-2.5 font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#cfe0f8] no-underline transition-colors hover:border-[#628bd0] hover:bg-[#173054] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7198ff]";

export default function HelpPanel({ onClose }) {
    useEffect(() => {
        const closeOnEscape = (event) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);

    return <section
        className="fixed inset-0 z-[10520] grid min-h-0 bg-[#020811]/[.78] px-[clamp(10px,1.7vw,28px)] pt-[calc(max(64px,calc(76px*var(--orbit-ui-scale)))+12px)] pb-[clamp(10px,1.7vw,28px)] backdrop-blur-[3px]"
        role="dialog"
        aria-modal="true"
        aria-label="Documentación de Orbit"
    >
        <article className="orbit-help-panel grid min-h-0 overflow-hidden rounded-[14px] border border-[#36557c] bg-[#0b1526] shadow-[0_28px_80px_rgba(0,0,0,.62)] [grid-template-rows:auto_minmax(0,1fr)]">
            <header className="flex min-h-[54px] items-center justify-between gap-3 border-b border-[#294667] bg-[linear-gradient(105deg,rgba(14,30,52,.98),rgba(8,18,33,.98))] px-[clamp(12px,1.4vw,20px)] py-2.5 max-[620px]:flex-wrap">
                <div className="min-w-0 font-[system-ui,sans-serif]">
                    <span className="block text-[9px] leading-none font-bold tracking-[.16em] text-[#7298dc]">ORBIT · HELP</span>
                    <strong className="mt-1 block truncate text-[15px] leading-none font-semibold text-[#edf4ff]">Documentación de Orbit</strong>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <a className={`${actionClass} max-[520px]:hidden`} href={localDocumentationUrl} target="_blank" rel="noreferrer" title="Abrir la documentación local en una pestaña nueva">Abrir en pestaña</a>
                    <a className={actionClass} href={publicDocumentationUrl} target="_blank" rel="noreferrer" title="Abrir la documentación publicada en GitHub Pages">Ver en Pages</a>
                    <PanelCloseButton label="Cerrar documentación" onClick={onClose} />
                </div>
            </header>
            <iframe className="h-full min-h-0 w-full border-0 bg-white" src={localDocumentationUrl} title="Documentación navegable de Orbit" />
        </article>
    </section>;
}

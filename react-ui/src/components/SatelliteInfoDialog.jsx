import { useEffect, useState } from "react";

const initialDialog = { open: false, html: "", title: "Satellite information" };
const scrollClass = "!min-h-0 !overflow-x-hidden !overflow-y-auto !pr-1 [scrollbar-color:var(--orbit-scrollbar-thumb)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:rounded-md [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-md [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-[var(--orbit-bg-secondary)] [&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,var(--orbit-scrollbar-thumb)_0%,var(--orbit-scrollbar-thumb-end)_100%)] [&::-webkit-scrollbar-thumb]:bg-clip-padding hover:[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,var(--orbit-scrollbar-thumb-end)_0%,var(--orbit-scrollbar-thumb)_100%)]";

/**
 * React-owned presentation layer for orbital information.
 *
 * The Cesium/runtime layer still prepares the domain-specific HTML while it is
 * being migrated.  It communicates through `orbit:tle-info`, keeping it out
 * of direct DOM manipulation and making this dialog independently testable.
 */
export default function SatelliteInfoDialog() {
    const [dialog, setDialog] = useState(initialDialog);

    useEffect(() => {
        const openDialog = (event) => setDialog({
            open: true,
            html: String(event.detail?.html || ""),
            title: String(event.detail?.title || initialDialog.title)
        });
        window.addEventListener("orbit:tle-info", openDialog);
        return () => window.removeEventListener("orbit:tle-info", openDialog);
    }, []);

    useEffect(() => {
        if (!dialog.open) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === "Escape") setDialog(initialDialog);
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [dialog.open]);

    if (!dialog.open) return null;
    return <div id="tleInfoModal" className="open !fixed !inset-0 !z-[10130] !flex !items-center !justify-center !bg-[var(--orbit-bg-overlay)] !p-4 !box-border" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDialog(initialDialog);
    }}>
        <section className="tle-info-panel !grid !min-h-0 !max-h-[88vh] !w-[min(calc(780px*var(--orbit-ui-scale)),96vw)] !grid-rows-[auto_minmax(0,1fr)] !gap-2.5 !overflow-hidden !rounded-[calc(14px*var(--orbit-ui-scale))] !border !border-[var(--orbit-border-accent)] !bg-[linear-gradient(180deg,var(--orbit-bg-modal)_0%,var(--orbit-bg-secondary)_100%)] !p-[calc(14px*var(--orbit-ui-scale))] !text-[var(--orbit-text-primary)] !shadow-[0_24px_60px_rgba(0,0,0,.45)]" role="dialog" aria-modal="true" aria-labelledby="tleInfoTitle">
            <header className="!flex !min-w-0 !items-center !justify-between">
                <h3 id="tleInfoTitle" className="!m-0 !min-w-0 !pr-2 !font-sans !text-[15px] !font-bold">{dialog.title}</h3>
                <button className="!size-[30px] !cursor-pointer !rounded-full !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-tertiary)] !text-[var(--orbit-text-primary)]" type="button" aria-label="Close" onClick={() => setDialog(initialDialog)}>×</button>
            </header>
            <div className={`tle-info-content ${scrollClass}`} tabIndex={0} aria-label="Contenido de los parametros TLE" dangerouslySetInnerHTML={{ __html: dialog.html }} />
        </section>
    </div>;
}

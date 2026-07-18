import { useEffect, useState } from "react";

const initialDialog = { open: false, html: "", title: "Satellite information" };

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
    return <div id="tleInfoModal" className="open" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDialog(initialDialog);
    }}>
        <section className="tle-info-panel" role="dialog" aria-modal="true" aria-labelledby="tleInfoTitle">
            <header className="tle-info-header">
                <h3 id="tleInfoTitle">{dialog.title}</h3>
                <button className="catalog-close-btn" type="button" aria-label="Close" onClick={() => setDialog(initialDialog)} />
            </header>
            <div className="tle-info-content" dangerouslySetInnerHTML={{ __html: dialog.html }} />
        </section>
    </div>;
}

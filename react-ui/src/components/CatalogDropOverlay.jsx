import { useEffect, useState } from "react";

export default function CatalogDropOverlay() {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const onState = (event) => setVisible(event.detail === true);
        window.addEventListener("orbit:catalog-drop-overlay", onState);
        return () => window.removeEventListener("orbit:catalog-drop-overlay", onState);
    }, []);
    if (!visible) return null;
    return <div id="globalCatalogDropOverlay" className="open"><div className="global-drop-overlay-panel"><h3>Soltar para importar</h3><p>Se importará al catálogo y se intentará añadir a la vista.</p></div></div>;
}

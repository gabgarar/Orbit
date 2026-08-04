import { useEffect, useState } from "react";

export default function CatalogDropOverlay() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const onState = (event) => setVisible(event.detail === true);
        window.addEventListener("orbit:catalog-drop-overlay", onState);
        return () => window.removeEventListener("orbit:catalog-drop-overlay", onState);
    }, []);

    if (!visible) return null;

    return <div
        id="globalCatalogDropOverlay"
        className="open !fixed !inset-0 !z-[10160] !flex !items-center !justify-center !bg-[#0c182c7a] !backdrop-blur-sm !pointer-events-none"
    >
        <div className="!w-[min(620px,92vw)] !rounded-2xl !border-2 !border-dashed !border-[var(--orbit-border-focus)] !bg-[var(--orbit-bg-secondary)] !px-6 !py-7 !text-center !shadow-[0_24px_64px_rgba(0,0,0,.45)]">
            <h3 className="!m-0 !mb-2 !font-sans !text-[22px] !leading-tight !font-bold !tracking-[.02em] !text-[var(--orbit-text-primary)]">Soltar para importar</h3>
            <p className="!m-0 !font-sans !text-[13px] !leading-[1.5] !font-semibold !text-[var(--orbit-text-secondary)]">Se importará al catálogo y se intentará añadir a la vista.</p>
        </div>
    </div>;
}

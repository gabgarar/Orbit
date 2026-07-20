import { useEffect, useState } from "react";

export default function SatelliteContextMenu() {
    const [menu, setMenu] = useState(null);

    useEffect(() => {
        const open = (event) => setMenu(event.detail);
        const close = () => setMenu(null);
        window.addEventListener("orbit:satellite-context-open", open);
        window.addEventListener("orbit:satellite-context-close", close);
        return () => {
            window.removeEventListener("orbit:satellite-context-open", open);
            window.removeEventListener("orbit:satellite-context-close", close);
        };
    }, []);

    if (!menu) return null;

    return <div
        id="satelliteContextMenu"
        className="open !fixed !z-[10050] !rounded-[10px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-secondary)] !p-1.5 !shadow-[0_10px_26px_rgba(0,0,0,.45)]"
        style={{ left: menu.left, top: menu.top }}
    >
        <button
            className="!h-8 !rounded-lg !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-tertiary)] !px-3 !font-sans !text-xs !leading-none !font-bold !text-[var(--orbit-text-primary)] !cursor-pointer hover:!bg-[var(--orbit-bg-hover)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]"
            type="button"
            onClick={() => {
                window.dispatchEvent(new CustomEvent("orbit:satellite-context-action", {
                    detail: { type: "visualization", id: menu.id }
                }));
                setMenu(null);
            }}
        >
            Opciones de visualización
        </button>
    </div>;
}

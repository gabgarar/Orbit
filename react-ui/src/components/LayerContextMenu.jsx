import { useEffect, useState } from "react";

export default function LayerContextMenu() {
    const [menu, setMenu] = useState(null);
    useEffect(() => {
        const open = (event) => setMenu(event.detail || null);
        const close = () => setMenu(null);
        window.addEventListener("orbit:layer-context-menu", open);
        window.addEventListener("orbit:layer-context-menu-close", close);
        return () => {
            window.removeEventListener("orbit:layer-context-menu", open);
            window.removeEventListener("orbit:layer-context-menu-close", close);
        };
    }, []);
    useEffect(() => {
        if (!menu) return undefined;
        const close = () => setMenu(null);
        const onKey = (event) => event.key === "Escape" && close();
        document.addEventListener("pointerdown", close, { once: true });
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menu]);
    if (!menu) return null;

    const select = (action) => {
        window.dispatchEvent(new CustomEvent("orbit:layer-context-action", {
            detail: { action, id: menu.id, source: "layer" }
        }));
        setMenu(null);
    };
    const actions = menu.groundStation
        ? [["station", "Update parameters"], ["remove", "Eliminar capa"]]
        : [
            ["rename", "Renombrar capa"],
            ...(menu.manualOrbit === true ? [["edit-manual", "Editar órbita manual"]] : []),
            ["propagated-parameters", "Parámetros orbitales propagados"],
            ["explain", "Explicar parámetros orbitales"],
            ["viz", "Opciones de visualización"],
            ["ground", menu.groundTrackVisible ? "Ground Track Hide" : "Ground Track Show"],
            ["export", "Exportar..."],
            ["remove", "Eliminar capa"]
        ];

    return <div id="catalogContextMenu" className="open !fixed !z-[10150] !grid !min-w-[270px] !gap-1 !rounded-[10px] !border !border-[var(--orbit-border-secondary)] !bg-[var(--orbit-bg-modal)] !p-1.5 !shadow-[0_16px_34px_rgba(0,0,0,.45)]" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>{actions.map(([action, label]) => <button className={`!cursor-pointer !rounded-md !border-0 !bg-transparent !px-2.5 !py-2 !text-left !font-[system-ui,sans-serif] !text-xs !font-semibold !text-[var(--orbit-text-primary)] hover:!bg-[var(--orbit-bg-hover)]${action === "remove" ? " !text-[#ff9aa8] hover:!bg-[rgba(191,55,77,.18)] hover:!text-[#ffd5dc]" : ""}`} type="button" key={action} onClick={() => select(action)}>{label}</button>)}</div>;
}

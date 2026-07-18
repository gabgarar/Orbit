import { useEffect, useState } from "react";

export default function LayerContextMenu() {
    const [menu, setMenu] = useState(null);
    useEffect(() => {
        const open = (event) => setMenu(event.detail || null);
        const close = () => setMenu(null);
        window.addEventListener("orbit:layer-context-menu", open);
        window.addEventListener("orbit:layer-context-menu-close", close);
        return () => { window.removeEventListener("orbit:layer-context-menu", open); window.removeEventListener("orbit:layer-context-menu-close", close); };
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
        window.dispatchEvent(new CustomEvent("orbit:layer-context-action", { detail: action }));
        setMenu(null);
    };
    const actions = menu.groundStation
        ? [["station", "Update parameters"], ["remove", "Eliminar capa"]]
        : [["rename", "Renombrar capa"], ["explain", "Explicar parámetros orbitales"], ["viz", "Opciones de visualización"], ["ground", menu.groundTrackVisible ? "Ground Track Hide" : "Ground Track Show"], ["export", "Exportar..."], ["remove", "Eliminar capa"]];
    return <div id="catalogContextMenu" className="open" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>{actions.map(([action, label]) => <button className={`catalog-context-action${action === "remove" ? " danger" : ""}`} type="button" key={action} onClick={() => select(action)}>{label}</button>)}</div>;
}

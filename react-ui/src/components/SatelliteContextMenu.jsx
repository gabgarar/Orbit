import { useEffect, useState } from "react";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";

const baseButtonClass = "!h-8 !rounded-lg !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-tertiary)] !px-3 !text-left !font-sans !text-xs !leading-none !font-bold !text-[var(--orbit-text-primary)] !cursor-pointer hover:!bg-[var(--orbit-bg-hover)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]";

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

    const selectAction = (type) => {
        window.dispatchEvent(new CustomEvent("orbit:satellite-context-action", {
            detail: { type, id: menu.id, sourceId: menu.sourceId || menu.id }
        }));
        setMenu(null);
    };

    const isCelestialBody = ["CELESTIAL_BODY", "EARTH"].includes(String(menu.layerType || "").toUpperCase())
        || String(menu.id || "").toLowerCase() === "body:earth";
    const isGroundStation = String(menu.layerType || "").toUpperCase() === "GROUND_STATION";

    return <div
        id="satelliteContextMenu"
        className="open !fixed !z-[10050] !grid !min-w-[214px] !gap-1 !rounded-[10px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-secondary)] !p-1.5 !shadow-[0_10px_26px_rgba(0,0,0,.45)]"
        style={{ left: menu.left, top: menu.top }}
    >
        <button
            className={baseButtonClass}
            type="button"
            onClick={() => selectAction("center-view")}
        >
            Centrar vista
        </button>
        {isGroundStation && <button
            className={baseButtonClass}
            type="button"
            onClick={() => selectAction("station")}
        >
            Actualizar parámetros
        </button>}
        {isGroundStation && <button
            className={baseButtonClass}
            type="button"
            data-ground-station-export-control="true"
            onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                openGroundStationExportMenu({
                    stationId: menu.id,
                    source: "satellite-context",
                    anchor: { left: rect.left, top: rect.bottom + 6 }
                });
                setMenu(null);
            }}
        >
            Exportar…
        </button>}
        {!isCelestialBody && !isGroundStation && <button
            className={baseButtonClass}
            type="button"
            onClick={() => selectAction("visualization")}
        >
            Opciones de visualización
        </button>}
        {!isCelestialBody && !isGroundStation && <button
            className="!h-8 !rounded-lg !border !border-[#365a89] !bg-[#10233d] !px-3 !text-left !font-sans !text-xs !leading-none !font-bold !text-[#c5dcff] !cursor-pointer hover:!border-[#6091d1] hover:!bg-[#173455] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[#80a7ff]"
            type="button"
            onClick={() => selectAction("propagated-parameters")}
        >
            Parámetros propagados
        </button>}
        {!isCelestialBody && !isGroundStation && menu.canEditManualOrbit === true && <button
            className="!h-8 !rounded-lg !border !border-[#3e68b0] !bg-[#162b4d] !px-3 !text-left !font-sans !text-xs !leading-none !font-bold !text-[#d7e7ff] !cursor-pointer hover:!border-[#6091e8] hover:!bg-[#203d68] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[#80a7ff]"
            type="button"
            onClick={() => selectAction("edit-manual")}
        >
            Editar órbita manual
        </button>}
    </div>;
}

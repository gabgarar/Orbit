import { useEffect, useState } from "react";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";

export default function LayerContextMenu() {
    const [menu, setMenu] = useState(null);
    const [basemapChoices, setBasemapChoices] = useState(null);
    const [basemapPickerOpen, setBasemapPickerOpen] = useState(false);
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
        const updateBasemapState = (event) => {
            const next = event.detail || null;
            if (!next) return;
            setBasemapChoices((current) => ({
                ...current,
                ...next,
                choices: Array.isArray(next.choices) ? next.choices : current?.choices
            }));
        };
        window.addEventListener("orbit:earth-basemap-choices", updateBasemapState);
        window.addEventListener("orbit:earth-basemap-state", updateBasemapState);
        return () => {
            window.removeEventListener("orbit:earth-basemap-choices", updateBasemapState);
            window.removeEventListener("orbit:earth-basemap-state", updateBasemapState);
        };
    }, []);
    useEffect(() => {
        setBasemapPickerOpen(false);
        setBasemapChoices(null);
    }, [menu?.id]);
    useEffect(() => {
        if (!menu) return undefined;
        const close = () => setMenu(null);
        const onKey = (event) => event.key === "Escape" && close();
        document.addEventListener("pointerdown", close, { once: true });
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menu]);
    if (!menu) return null;

    const select = (action, event) => {
        if (action === "earth-basemap") {
            setBasemapPickerOpen((open) => !open);
            window.dispatchEvent(new CustomEvent("orbit:earth-basemap-request", {
                detail: { id: menu.id, source: "layer-context" }
            }));
            return;
        }
        if (action === "export-station") {
            const rect = event.currentTarget.getBoundingClientRect();
            openGroundStationExportMenu({
                stationId: menu.id,
                source: "layer-context",
                anchor: { left: rect.left, top: rect.bottom + 6 }
            });
            setMenu(null);
            return;
        }
        window.dispatchEvent(new CustomEvent("orbit:layer-context-action", {
            detail: { action, id: menu.id, source: "layer" }
        }));
        setMenu(null);
    };
    const layerType = String(menu.layerType || "").toUpperCase();
    const isEarth = menu.earth === true || layerType === "EARTH" || String(menu.id || "").toLowerCase() === "body:earth";
    const isCelestialBody = layerType === "CELESTIAL_BODY" || isEarth;
    const visibilityAction = ["toggle-visibility", menu.visible === false ? "Mostrar capa" : "Ocultar capa"];
    const baseActions = menu.groundStation
        ? [["center-view", "Centrar vista"], visibilityAction, ["station", "Actualizar parámetros"], ["export-station", "Exportar…"], ["remove", "Eliminar capa"]]
        : [
            ["center-view", "Centrar vista"],
            visibilityAction,
            ["rename", "Renombrar capa"],
            ...(menu.manualOrbit === true ? [["edit-manual", "Editar órbita manual"]] : []),
            ["propagated-parameters", "Efemérides"],
            ["explain", "Explicar parámetros orbitales"],
            ["viz", "Opciones de visualización"],
            ["ground", menu.groundTrackVisible ? "Ground Track Hide" : "Ground Track Show"],
            ["export", "Exportar..."],
            ["remove", "Eliminar capa"]
        ];
    const actions = isEarth
        ? [["center-view", "Centrar vista"], visibilityAction, ["earth-basemap", "Mapa base"]]
        : isCelestialBody
        ? [["center-view", "Centrar vista"], visibilityAction, ["rename", "Renombrar capa"], ["remove", "Eliminar capa"]]
        : baseActions;

    const choices = Array.isArray(basemapChoices?.choices) ? basemapChoices.choices : [];
    const chooseBasemap = (choice) => {
        const basemapId = String(choice?.id || "").trim();
        if (!basemapId || choice?.available === false) return;
        window.dispatchEvent(new CustomEvent("orbit:earth-basemap-request", {
            detail: { id: menu.id, basemapId, source: "layer-context" }
        }));
        setBasemapPickerOpen(false);
    };

    return <div id="catalogContextMenu" className="open !fixed !z-[10150] !grid !min-w-[270px] !gap-1 !rounded-[10px] !border !border-[var(--orbit-border-secondary)] !bg-[var(--orbit-bg-modal)] !p-1.5 !shadow-[0_16px_34px_rgba(0,0,0,.45)]" style={{ left: menu.left, top: menu.top }} onPointerDown={(event) => event.stopPropagation()}>{actions.map(([action, label]) => <button className={`!cursor-pointer !rounded-md !border-0 !bg-transparent !px-2.5 !py-2 !text-left !font-[system-ui,sans-serif] !text-xs !font-semibold !text-[var(--orbit-text-primary)] hover:!bg-[var(--orbit-bg-hover)]${action === "remove" ? " !text-[#ff9aa8] hover:!bg-[rgba(191,55,77,.18)] hover:!text-[#ffd5dc]" : ""}`} type="button" key={action} onClick={(event) => select(action, event)}>{label}{action === "earth-basemap" && <span className="float-right text-[#8da5ca]">›</span>}</button>)}{isEarth && basemapPickerOpen && <div className="mt-1 grid gap-1 border-t border-[#203450] pt-1" aria-label="Seleccionar mapa base">{choices.length ? choices.map((choice) => {
        const id = String(choice?.id || "");
        const selected = id && id === String(basemapChoices?.selectedId || "");
        const unavailable = choice?.available === false;
        const attribution = String(choice?.attribution || "").trim();
        return <button className={`!rounded-md !border !px-2.5 !py-1.5 !text-left !font-[system-ui,sans-serif] !text-[11px] !font-semibold ${unavailable ? "!cursor-not-allowed !border-transparent !bg-transparent !text-[#71819a] !opacity-70" : (selected ? "!cursor-pointer !border-[#426bf0] !bg-[#1a315c] !text-[#e7efff]" : "!cursor-pointer !border-transparent !bg-transparent !text-[#bdcae0] hover:!border-[#294568] hover:!bg-[#11213a]")}`} type="button" key={id || choice?.label} disabled={unavailable} title={unavailable ? (choice?.unavailableReason || "No disponible") : (choice?.description || choice?.label)} onClick={() => chooseBasemap(choice)}><span className="block">{choice?.label || choice?.name || id}</span>{choice?.description && <span className="mt-0.5 block text-[9px] font-medium leading-tight opacity-75">{choice.description}</span>}{attribution && <span className="mt-0.5 block text-[9px] leading-tight opacity-65">{attribution}</span>}{unavailable && <span className="mt-0.5 block text-[9px] leading-tight text-[#d6a77b]">{choice?.unavailableReason || "No disponible"}</span>}</button>;
    }) : <div className="px-2.5 py-1.5 text-[11px] font-medium text-[#91a1b8]">Cargando mapas base…</div>}</div>}</div>;
}

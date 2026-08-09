import { useEffect, useState } from "react";
import { ActionMenuItem, ActionMenuSeparator, ActionMenuSurface } from "./ActionMenuSurface.jsx";
import { BodiesIcon, FolderIcon, OrbitalSatelliteIcon } from "./icons.jsx";

const MENU_WIDTH = 286;
const MENU_GAP = 8;

function clamp(value, lower, upper) {
    return Math.min(Math.max(value, lower), Math.max(lower, upper));
}

function getSubmenuPosition(menu, level = 1) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const leftCandidate = menu.left + MENU_WIDTH - 14;
    const left = leftCandidate + MENU_WIDTH + MENU_GAP <= viewportWidth
        ? leftCandidate
        : clamp(menu.left - MENU_WIDTH + 14, MENU_GAP, viewportWidth - MENU_WIDTH - MENU_GAP);
    const top = clamp(menu.top + 36 + (level * 4), MENU_GAP, viewportHeight - 210 - MENU_GAP);
    return { left, top };
}

function normalizeMenuAnchor(detail) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rawLeft = Number(detail?.left);
    const rawTop = Number(detail?.top);
    const menuHeight = detail?.kind === "bodies" ? 150 : 352;
    return {
        left: clamp(Number.isFinite(rawLeft) ? rawLeft : MENU_GAP, MENU_GAP, viewportWidth - MENU_WIDTH - MENU_GAP),
        top: clamp(Number.isFinite(rawTop) ? rawTop : MENU_GAP, MENU_GAP, viewportHeight - menuHeight - MENU_GAP)
    };
}

function dispatchTreeAction(menu, action) {
    window.dispatchEvent(new CustomEvent("orbit:tree-context-menu-action", {
        detail: {
            action,
            kind: menu.kind,
            folderId: menu.folderId || null
        }
    }));
}

/**
 * React presentation for the two structural branches of the Layers tree.
 *
 * `objectSidebar` remains the domain owner: it tells us which node was
 * clicked and receives a semantic action back. That keeps folder assignment,
 * imports, confirmation dialogs and the legacy fallback in one place.
 */
export default function TreeContextMenu() {
    const [menu, setMenu] = useState(null);
    const [submenu, setSubmenu] = useState(null);

    const close = ({ notify = false } = {}) => {
        setMenu(null);
        setSubmenu(null);
        if (notify) {
            window.dispatchEvent(new Event("orbit:tree-context-menu-dismiss"));
        }
    };

    useEffect(() => {
        const open = (event) => {
            const detail = event.detail || null;
            if (!detail || !["folder", "bodies"].includes(detail.kind)) return;
            setMenu({ ...detail, ...normalizeMenuAnchor(detail) });
            setSubmenu(null);
        };
        const closeFromRuntime = () => close();

        window.addEventListener("orbit:tree-context-menu", open);
        window.addEventListener("orbit:tree-context-menu-close", closeFromRuntime);
        window.__orbitTreeContextMenuReady = true;
        window.dispatchEvent(new CustomEvent("orbit:tree-context-menu-ready", { detail: { ready: true } }));
        return () => {
            window.removeEventListener("orbit:tree-context-menu", open);
            window.removeEventListener("orbit:tree-context-menu-close", closeFromRuntime);
            if (window.__orbitTreeContextMenuReady === true) {
                window.__orbitTreeContextMenuReady = false;
                window.dispatchEvent(new CustomEvent("orbit:tree-context-menu-ready", { detail: { ready: false } }));
            }
        };
    }, []);

    useEffect(() => {
        if (!menu) return undefined;
        const focusFirstAction = window.requestAnimationFrame(() => {
            const activeMenuId = submenu === "satellite"
                ? "treeContextSatelliteMenu"
                : (submenu === "add" ? "treeContextAddMenu" : "treeContextMenu");
            document.querySelector(`#${activeMenuId} [data-context-menu-action='true']`)?.focus({ preventScroll: true });
        });
        const onPointerDown = (event) => {
            if (event.target.closest?.(".orbit-tree-context-menu")) return;
            close({ notify: true });
        };
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close({ notify: true });
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFirstAction);
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [menu, submenu]);

    if (!menu) return null;

    const isBodies = menu.kind === "bodies";
    const title = String(menu.title || (isBodies ? "Bodies" : "Carpeta"));
    const submit = (action) => {
        dispatchTreeAction(menu, action);
        close();
    };
    const openAdd = () => setSubmenu("add");
    const openSatellite = () => setSubmenu("satellite");
    const rootIcon = isBodies ? <BodiesIcon /> : <FolderIcon />;
    const addPosition = getSubmenuPosition(menu, 1);
    const satellitePosition = getSubmenuPosition(menu, 2);

    return <>
        <ActionMenuSurface
            id="treeContextMenu"
            className="orbit-tree-context-menu"
            title={title}
            icon={rootIcon}
            left={menu.left}
            top={menu.top}
            ariaLabel={`Acciones de ${title}`}
        >
            {isBodies ? <>
                <ActionMenuItem title="Mostrar todos los cuerpos" description="Activa la visibilidad del grupo Bodies" onClick={() => submit("bodies-show")} />
                <ActionMenuItem title="Ocultar todos los cuerpos" description="Desactiva la visibilidad del grupo Bodies" onClick={() => submit("bodies-hide")} />
            </> : <>
                <ActionMenuItem title="Mostrar todas las capas" description="Activa las capas dentro de esta carpeta" onClick={() => submit("show")} />
                <ActionMenuItem title="Ocultar todas las capas" description="Desactiva las capas dentro de esta carpeta" onClick={() => submit("hide")} />
                <ActionMenuSeparator />
                <ActionMenuItem title="Añadir capa" description="Importa o crea una capa en esta carpeta" onClick={openAdd} />
                <ActionMenuItem title="Nueva subcarpeta" description="Crea una carpeta dentro de esta ubicación" onClick={() => submit("create")} />
                <ActionMenuItem title="Renombrar carpeta" description="Cambia el nombre de esta carpeta" onClick={() => submit("rename")} />
                <ActionMenuSeparator />
                <ActionMenuItem title="Eliminar carpeta" description="Reubica su contenido en el proyecto" danger onClick={() => submit("delete")} />
            </>}
        </ActionMenuSurface>

        {submenu === "add" && <ActionMenuSurface
            id="treeContextAddMenu"
            className="orbit-tree-context-menu"
            title="Añadir capa"
            icon={<FolderIcon />}
            left={addPosition.left}
            top={addPosition.top}
            ariaLabel={`Añadir una capa a ${title}`}
        >
            <ActionMenuItem title="Añadir satélite" description="TLE desde catálogo o importación" onClick={openSatellite} />
            <ActionMenuItem title="Estación de tierra" description="Abre el diseño de una nueva estación" onClick={() => submit("station")} />
        </ActionMenuSurface>}

        {submenu === "satellite" && <ActionMenuSurface
            id="treeContextSatelliteMenu"
            className="orbit-tree-context-menu"
            title="Añadir satélite"
            icon={<OrbitalSatelliteIcon />}
            left={satellitePosition.left}
            top={satellitePosition.top}
            ariaLabel={`Añadir un satélite a ${title}`}
        >
            <ActionMenuItem title="TLE desde catálogo" description="Busca e importa desde el catálogo" onClick={() => submit("catalog")} />
            <ActionMenuItem title="Importar satélite" description="Carga un archivo de órbita local" onClick={() => submit("import")} />
        </ActionMenuSurface>}
    </>;
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { synchronizeOrbitClientState } from "../../front/js/features/identity/clientStateReset.js";
import "./styles.css";

// The legacy Cesium runtime is loaded after React has mounted.  Initialise the
// gate synchronously so a queued/synthetic project command cannot race the
// first identity render.  The session itself is populated by App only after a
// successful local or provider-backed unlock.
if (typeof window !== "undefined") {
    window.__orbitIdentityAccessRequired = true;
    window.__orbitIdentitySession = null;
}

function renderClientStateRetry(rootElement, cause = null) {
    if (!rootElement || typeof document === "undefined") return;
    const screen = document.createElement("main");
    screen.className = "grid h-full place-items-center bg-[#020811] p-6 text-center font-[var(--orbit-font-sans)] text-[#e5efff]";
    screen.setAttribute("role", "alert");

    const panel = document.createElement("section");
    panel.className = "w-full max-w-md rounded-xl border border-[#35557e] bg-[#0b1726] p-7 shadow-[0_20px_60px_rgba(0,0,0,.42)]";
    const title = document.createElement("h1");
    title.className = "m-0 text-lg font-semibold";
    title.textContent = "No se ha podido preparar Orbit";
    const message = document.createElement("p");
    message.className = "mt-3 mb-0 text-sm leading-6 text-[#b8c9e8]";
    message.textContent = cause?.code === "CLIENT_STATE_INDEXED_DB_BLOCKED"
        ? "Cierra las demás pestañas de Orbit y vuelve a intentarlo. La aplicación no se ha iniciado para evitar usar datos locales inconsistentes."
        : "No se ha iniciado la aplicación para evitar usar datos locales inconsistentes. Comprueba la conexión con Orbit y vuelve a intentarlo.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "mt-6 rounded-lg border border-[#6086ff] bg-[#3657dc] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4668ee]";
    retry.textContent = "Reintentar";
    retry.addEventListener("click", () => window.location.reload());
    panel.append(title, message, retry);
    screen.append(panel);
    rootElement.replaceChildren(screen);
}

async function bootOrbit() {
    const rootElement = document.getElementById("root");
    if (!rootElement) return;
    try {
        await synchronizeOrbitClientState();
    } catch (cause) {
        renderClientStateRetry(rootElement, cause);
        return;
    }
    createRoot(rootElement).render(
        <StrictMode>
            <App />
        </StrictMode>
    );
}

void bootOrbit();

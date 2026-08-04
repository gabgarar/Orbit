import { useRef, useState } from "react";
import { requestProjectCommand } from "../../services/projectRuntime.js";

const panelClass = "relative w-[min(440px,100%)] rounded-[18px] border border-[#5899e799] bg-[linear-gradient(135deg,rgba(18,62,112,.96),rgba(5,18,36,.98))] p-8 font-sans text-[var(--orbit-text-primary)] shadow-[0_26px_70px_rgba(0,0,0,.56)]";
const buttonClass = "rounded-lg border border-[var(--orbit-border-primary)] bg-[#122543e6] px-[14px] py-2.5 text-[13px] leading-none font-semibold text-[var(--orbit-text-primary)] cursor-pointer transition-colors hover:bg-[var(--orbit-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#54a8ff]";

export default function OpenProjectForm({ onClose }) {
    const fileInput = useRef(null);
    const [openError, setOpenError] = useState("");

    const selectFile = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const result = requestProjectCommand({ type: "open", file });
        event.target.value = "";
        if (!result.accepted) {
            setOpenError("El visor no está disponible. Recarga la aplicación para volver a intentarlo.");
            return;
        }
        onClose();
    };

    return <section className={panelClass}>
        <button className="absolute top-[14px] right-[14px] grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--orbit-border-primary)] bg-transparent p-0 font-sans text-[22px] leading-none text-[var(--orbit-text-primary)] cursor-pointer hover:bg-[var(--orbit-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#54a8ff]" type="button" aria-label="Cerrar" onClick={onClose}>&#215;</button>
        <p className="m-0 mb-2.5 font-sans text-[11px] leading-none font-extrabold tracking-[3px] text-[#52a8ff]">ORBIT PROJECT</p>
        <h2 className="m-0 mb-2.5 font-sans text-[26px] leading-[1.2] font-bold">Abrir proyecto</h2>
        <p className="m-0 mb-6 text-sm leading-[1.55] text-[var(--orbit-text-secondary)]">Selecciona un archivo de proyecto exportado por Orbit.</p>
        {openError && <p className="-mt-2 mb-[18px] text-sm leading-[1.45] text-[#ffb8b8]" role="alert">{openError}</p>}
        <input ref={fileInput} id="openProjectFileInput" type="file" accept=".json,application/json" hidden onChange={selectFile} />
        <button className="grid w-full gap-[7px] rounded-[10px] border border-dashed border-[#4e96e6] bg-[#06183085] p-[22px] text-center font-sans text-[var(--orbit-text-primary)] cursor-pointer hover:border-[#78b9ff] hover:bg-[#1246826b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#54a8ff]" type="button" onClick={() => fileInput.current?.click()}>
            <span>Seleccionar archivo .json</span>
            <small className="text-[var(--orbit-text-tertiary)]">El proyecto se abrirá en esta sesión.</small>
        </button>
        <div className="mt-[26px] flex justify-end gap-2.5">
            <button className={buttonClass} type="button" onClick={onClose}>Cancelar</button>
        </div>
    </section>;
}

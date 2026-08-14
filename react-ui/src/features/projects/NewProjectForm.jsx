import { useEffect, useRef, useState } from "react";
import { requestProjectCommand } from "../../services/projectRuntime.js";
import PanelCloseButton from "../../components/PanelCloseButton.jsx";

const panelClass = "relative w-[min(440px,100%)] rounded-[18px] border border-[#5899e799] bg-[linear-gradient(135deg,rgba(18,62,112,.96),rgba(5,18,36,.98))] p-8 font-sans text-[var(--orbit-text-primary)] shadow-[0_26px_70px_rgba(0,0,0,.56)]";
const buttonClass = "rounded-lg border border-[var(--orbit-border-primary)] bg-[#122543e6] px-[14px] py-2.5 text-[13px] leading-none font-semibold text-[var(--orbit-text-primary)] cursor-pointer transition-colors hover:bg-[var(--orbit-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#54a8ff]";

export default function NewProjectForm({ onClose, startupReadiness }) {
    const [projectName, setProjectName] = useState("Untitled project");
    const [submitError, setSubmitError] = useState("");
    const nameInput = useRef(null);
    const startupReady = startupReadiness?.ready === true;

    useEffect(() => {
        nameInput.current?.focus();
        nameInput.current?.select();
    }, []);

    const submit = (event) => {
        event.preventDefault();
        if (!startupReady) {
            setSubmitError(startupReadiness?.message || "Orbit todavía está preparando los datos necesarios para proyectos.");
            return;
        }
        const name = projectName.trim();
        if (!name) return;
        const result = requestProjectCommand({ type: "new", name });
        if (!result.accepted) {
            setSubmitError(result.reason || "El visor no está disponible. Recarga la aplicación para volver a intentarlo.");
            return;
        }
        onClose();
    };

    return <form className={panelClass} onSubmit={submit}>
        <PanelCloseButton className="absolute top-[14px] right-[14px]" onClick={onClose} />
        <p className="m-0 mb-2.5 font-sans text-[11px] leading-none font-extrabold tracking-[3px] text-[#52a8ff]">ORBIT PROJECT</p>
        <h2 className="m-0 mb-2.5 font-sans text-[26px] leading-[1.2] font-bold">Nuevo proyecto</h2>
        <p className="m-0 mb-6 text-sm leading-[1.55] text-[var(--orbit-text-secondary)]">Define un nombre para comenzar un proyecto vacío.</p>
        {!startupReady && <p className="-mt-3 mb-[18px] text-sm leading-[1.45] text-[#b9d9ff]" role="status">{startupReadiness?.message || "Preparando datos críticos…"}</p>}
        {submitError && <p className="-mt-2 mb-[18px] text-sm leading-[1.45] text-[#ffb8b8]" role="alert">{submitError}</p>}
        <label className="grid gap-2 font-sans text-[13px] leading-none font-semibold text-[var(--orbit-text-secondary)]">
            Nombre del proyecto
            <input className="h-[42px] rounded-lg border border-[var(--orbit-border-primary)] bg-[#020a16b8] px-3 font-sans text-sm leading-none text-[var(--orbit-text-primary)] outline-none focus:border-[#54a8ff] focus:shadow-[0_0_0_3px_rgba(57,144,255,.18)] disabled:cursor-not-allowed disabled:opacity-55" ref={nameInput} type="text" maxLength="80" required autoComplete="off" value={projectName} disabled={!startupReady} onChange={(event) => setProjectName(event.target.value)} />
        </label>
        <div className="mt-[26px] flex justify-end gap-2.5">
            <button className={buttonClass} type="button" onClick={onClose}>Cancelar</button>
            <button className={`${buttonClass} border-[#278dff] bg-[linear-gradient(135deg,#287eff,#1747bb)] text-white hover:bg-[#245fd2] disabled:cursor-not-allowed disabled:opacity-55`} type="submit" disabled={!startupReady} title={!startupReady ? startupReadiness?.message : undefined}>Crear proyecto</button>
        </div>
    </form>;
}

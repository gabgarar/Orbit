import { useEffect, useState } from "react";
import PanelCloseButton from "./PanelCloseButton.jsx";

const buttonClass = "!rounded-lg !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-tertiary)] !px-3.5 !py-[9px] !font-sans !text-sm !text-[var(--orbit-text-primary)] !cursor-pointer hover:!bg-[var(--orbit-bg-hover)] focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-[var(--orbit-border-focus)]";

export default function FolderNameDialog() {
    const [request, setRequest] = useState(null);
    const [value, setValue] = useState("");

    const close = (name = null) => {
        if (request) {
            window.dispatchEvent(new CustomEvent("orbit:folder-name-response", {
                detail: { id: request.id, name }
            }));
        }
        setRequest(null);
    };

    useEffect(() => {
        const open = (event) => {
            setRequest(event.detail);
            setValue(event.detail?.initialValue || "");
        };
        window.addEventListener("orbit:folder-name-request", open);
        return () => window.removeEventListener("orbit:folder-name-request", open);
    }, []);

    if (!request) return null;

    return <div
        id="folderNameModal"
        className="open !fixed !inset-0 !z-[10400] !grid !place-items-center !bg-[#02070fad] !p-4 !backdrop-blur-sm"
        onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
        <form
            className="!relative !w-[min(400px,calc(100vw-32px))] !rounded-[14px] !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-modal)] !p-6 !shadow-[0_24px_60px_rgba(0,0,0,.54)]"
            onSubmit={(event) => {
                event.preventDefault();
                if (value.trim()) close(value.trim());
            }}
        >
            <PanelCloseButton className="!absolute !top-4 !right-4" label="Cerrar diálogo de carpeta" onClick={() => close()} />
            <h3 className="!m-0 !mb-5 !pr-8 !font-sans !text-lg !font-bold !text-[var(--orbit-text-primary)]">{request.title}</h3>
            <label className="!grid !gap-2 !font-sans !text-[13px] !leading-none !font-semibold !text-[var(--orbit-text-secondary)]">
                <span>{request.label}</span>
                <input
                    className="!h-10 !rounded-lg !border !border-[var(--orbit-border-primary)] !bg-[var(--orbit-bg-primary)] !px-3 !font-sans !text-sm !text-[var(--orbit-text-primary)] !outline-none focus:!border-[var(--orbit-border-focus)] focus:!shadow-[0_0_0_3px_rgba(55,141,255,.16)]"
                    autoFocus
                    maxLength="80"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                />
            </label>
            <div className="!mt-[22px] !flex !justify-end !gap-[9px]">
                <button className={buttonClass} type="button" onClick={() => close()}>Cancelar</button>
                <button className={`${buttonClass} !border-[var(--orbit-border-focus)] !bg-[var(--orbit-bg-active)]`} type="submit">Crear carpeta</button>
            </div>
        </form>
    </div>;
}

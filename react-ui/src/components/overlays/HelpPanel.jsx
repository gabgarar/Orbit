import PanelCloseButton from "../PanelCloseButton.jsx";

export default function HelpPanel({ onClose }) {
    return <aside className="orbit-floating-panel fixed top-[82px] right-[22px] z-[10120] w-[260px] rounded-xl border border-[#29466f] bg-[#0d1728] p-[18px] font-[system-ui] text-[13px] leading-[1.45] text-[#c9d7ed] shadow-[0_18px_42px_rgba(0,0,0,.42)]"><PanelCloseButton className="absolute top-2 right-[9px]" label="Cerrar ayuda" onClick={onClose} /><strong className="block text-[15px] text-[#f0f5ff]">Ayuda</strong><p className="mt-2">Busca un satelite, seleccionalo y usa la barra temporal para explorar su orbita.</p></aside>;
}

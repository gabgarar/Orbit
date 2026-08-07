/**
 * Shared window close affordance.
 *
 * It deliberately mirrors the selected-object information panel: a quiet,
 * borderless × which becomes white on hover.  The invisible 30 px hit target
 * keeps it easy to use without turning every window header into a row of
 * boxed controls.
 */
const baseClass = "inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 font-[system-ui,sans-serif] text-2xl leading-none text-[#b7c6dc] transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5c83ff]";

export default function PanelCloseButton({ className = "", label = "Cerrar", ...props }) {
    return <button {...props} className={`${baseClass} ${className}`.trim()} type="button" aria-label={label} title={label}>&times;</button>;
}

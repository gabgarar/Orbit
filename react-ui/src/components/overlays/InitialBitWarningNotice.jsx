/**
 * A non-modal startup notice. It never changes readiness or captures focus:
 * a completed warning can coexist with an operational, degraded-ready Orbit.
 */
export default function InitialBitWarningNotice({ notice, onDismiss, onOpenDiagnostics }) {
    if (!notice) return null;
    const visibleWarnings = notice.warnings.slice(0, 3);
    const remaining = Math.max(0, notice.warnings.length - visibleWarnings.length);
    return <aside
        className="fixed top-[calc(max(64px,calc(76px*var(--orbit-ui-scale)))+12px)] right-[clamp(10px,1.7vw,28px)] z-[10525] w-[min(420px,calc(100vw-20px))] rounded-[12px] border border-[#9b7435] bg-[linear-gradient(145deg,rgba(61,43,17,.98),rgba(30,24,16,.98))] p-3 text-[#fff0ce] shadow-[0_22px_60px_rgba(0,0,0,.58)] backdrop-blur-[8px]"
        role="alert"
        aria-atomic="true"
        aria-labelledby="initialBitWarningTitle"
        data-testid="initial-bit-warning-notice"
    >
        <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-[#c8943a] bg-[#5c4116] text-[12px] font-bold text-[#ffe0a1]" aria-hidden="true">!</span>
            <div className="min-w-0 flex-1">
                <span className="block text-[9px] leading-none font-bold tracking-[.15em] text-[#edc570]">ORBIT · PBIT / IBIT</span>
                <h2 id="initialBitWarningTitle" className="mt-1 mb-0 text-[14px] leading-tight font-semibold text-[#fff3d8]">{notice.title}</h2>
                <p className="mt-1 mb-0 text-[11px] leading-snug text-[#f2d8a0]">{notice.message}</p>
            </div>
            <button className="-mt-0.5 -mr-0.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-transparent bg-transparent text-[18px] leading-none text-[#ead4a5] hover:border-[#b8883b] hover:bg-[#4c3616] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffe39a]" type="button" onClick={onDismiss} aria-label="Descartar avisos de la comprobación inicial de BIT">×</button>
        </div>
        <ul className="mt-2.5 mb-0 grid list-none gap-1.5 p-0" aria-label="Avisos de la comprobación inicial de BIT">
            {visibleWarnings.map((warning) => <li className="rounded-[6px] border border-[#76582d] bg-[#201a12]/75 px-2 py-1.5 text-[10px] leading-snug text-[#ffe6b5]" key={warning}>{warning}</li>)}
        </ul>
        {remaining > 0 && <p className="mt-1.5 mb-0 text-[10px] leading-snug text-[#d9bd82]">Y {remaining} aviso{remaining === 1 ? "" : "s"} más en el BIT.</p>}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button className="cursor-pointer rounded-[6px] border border-[#c49547] bg-[#5b411a] px-2.5 py-1.5 text-[10px] leading-none font-semibold text-[#fff0ca] hover:border-[#ebc46f] hover:bg-[#745321] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffe39a]" type="button" onClick={() => {
                onDismiss();
                onOpenDiagnostics();
            }}>Revisar BIT</button>
            <button className="cursor-pointer rounded-[6px] border border-[#8c7040] bg-transparent px-2.5 py-1.5 text-[10px] leading-none font-semibold text-[#e8d1a0] hover:border-[#d3aa5d] hover:bg-[#4a3516] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffe39a]" type="button" onClick={onDismiss}>Entendido</button>
        </div>
    </aside>;
}

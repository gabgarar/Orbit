import { useEffect, useState } from "react";

export default function HeatMapLegend() {
    const [visible, setVisible] = useState(false);
    useEffect(() => { const update = (event) => setVisible(event.detail === true); window.addEventListener("orbit:heat-legend", update); return () => window.removeEventListener("orbit:heat-legend", update); }, []);
    if (!visible) return null;
    return <aside id="groundStationHeatLegend" className="fixed bottom-[14px] left-[14px] z-[10150] block w-60 rounded-[10px] border border-[var(--orbit-border-secondary)] bg-[linear-gradient(180deg,rgba(19,31,54,.94)_0%,rgba(13,24,44,.94)_100%)] px-2.5 pt-2.5 pb-2 text-[var(--orbit-text-primary)] shadow-[0_12px_28px_rgba(0,0,0,.42)]" aria-label="Leyenda de cobertura heat map"><div className="mb-2 text-xs leading-[1.2] font-bold tracking-[.02em]">Heat map cobertura</div><div className="h-3 rounded-full border border-[var(--orbit-border-primary)] bg-[linear-gradient(90deg,#cc3d55_0%,#f29a3a_35%,#f7d34d_65%,#3af27a_100%)]" aria-hidden="true" /><div className="mt-1.5 flex justify-between text-[10px] leading-none font-semibold text-[var(--orbit-text-secondary)]"><span>0%</span><span>30%</span><span>55%</span><span>80%</span><span>100%</span></div></aside>;
}

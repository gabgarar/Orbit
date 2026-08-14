import { getStartupProjectReadiness } from "../../../../front/js/features/diagnostics/startupStatus.js";

const actionButtonClass = "!min-w-0 !flex-1 !rounded-[11px] !border !border-[#168fff] !bg-[#051224a3] !px-[14px] !py-4 !font-sans !text-lg !leading-none !font-semibold !text-white !cursor-pointer !transition-[transform,background] hover:!-translate-y-0.5 hover:!bg-[#155cb45c] disabled:!cursor-not-allowed disabled:!opacity-[.52] disabled:hover:!translate-y-0 disabled:hover:!bg-[#051224a3]";

export default function ProjectWelcome({ onAction, runtimeStatus, startup }) {
    const runtimeFailed = runtimeStatus?.state === "failed";
    const readiness = getStartupProjectReadiness(startup);
    const actionsDisabled = runtimeFailed || !readiness.ready;

    return <section
        id="projectWelcome"
        className="react-project-welcome !fixed !inset-0 !z-[10500] !grid !place-items-center !overflow-hidden !bg-[#020811] !p-5"
        aria-label="Bienvenida de Orbit"
    >
        <img className="absolute inset-0 h-full w-full object-cover" src="/assets/fonts/fondo.png" alt="" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#020811]/[.06] to-[#020811]/[.22]" aria-hidden="true" />
        <div className="relative z-10 w-[min(510px,calc(100vw-40px))] rounded-[30px] border border-[#71a9e694] bg-[linear-gradient(135deg,rgba(9,40,77,.91),rgba(3,13,27,.88))] px-[42px] pt-[54px] pb-11 text-center shadow-[0_32px_90px_rgba(0,0,0,.58)] max-[520px]:px-6 max-[520px]:pt-9">
            <div className="mx-auto h-[76px] w-[100px] bg-[url('/assets/icon/favicon.svg')] bg-center bg-[length:96%] bg-no-repeat saturate-[1.15] drop-shadow-[0_0_18px_rgba(23,155,255,.5)]" aria-hidden="true" />
            <div className="mt-[30px] font-sans text-[19px] leading-none font-extrabold tracking-[10px] text-[#2888ff]">O R B I T</div>
            <h1 className="!mt-[30px] !mb-[18px] !font-sans !text-[clamp(34px,3vw,48px)] !leading-[1.1] !font-semibold !text-white">Welcome to Orbit</h1>
            <div className="mx-auto mb-[27px] h-[3px] w-16 rounded-lg bg-[#168fff] shadow-[0_0_14px_rgba(22,143,255,.6)]" />
            <p className="!m-0 !font-sans !text-xl !leading-[1.55] !font-normal !text-[#b9c9df]">Create a project to start modelling your space operations, or open an existing one.</p>
            {runtimeFailed && <div className="mt-5 grid gap-2 rounded-xl border border-[#ff7171ad] bg-[#71141e75] p-[14px] text-left font-sans text-[13px] leading-[1.45] text-[#ffd8d8]" role="alert">
                <strong className="text-white">El visor no se pudo iniciar.</strong>
                <span>Recarga la aplicación para volver a intentarlo.</span>
                <button className="!mt-0.5 !w-fit !rounded-lg !border !border-[#ffb5b5b3] !bg-[#480f17cc] !px-[11px] !py-2 !font-sans !text-xs !leading-none !text-white !cursor-pointer hover:!bg-[#641721]" type="button" onClick={() => window.location.reload()}>Recargar aplicación</button>
            </div>}
            {!runtimeFailed && !readiness.ready && <div className="mt-5 grid gap-1.5 rounded-xl border border-[#5f8cbd] bg-[#0c2948d9] p-[14px] text-left font-sans text-[13px] leading-[1.45] text-[#d7e8ff]" data-testid="project-startup-gate" role="status">
                <strong className="text-white">Preparando Orbit</strong>
                <span>{readiness.message}</span>
                <small className="text-[#a9c5e5]">La escena y las comprobaciones siguen disponibles durante este proceso.</small>
            </div>}
            <div className="mt-10 flex justify-center gap-4 max-[480px]:flex-col">
                <button className={`${actionButtonClass} !bg-[linear-gradient(135deg,#168fff,#1046bc)] !shadow-[0_12px_26px_rgba(10,93,219,.32)]`} type="button" disabled={actionsDisabled} title={!readiness.ready ? readiness.message : undefined} onClick={() => onAction("new")}>New project</button>
                <button className={actionButtonClass} type="button" disabled={actionsDisabled} title={!readiness.ready ? readiness.message : undefined} onClick={() => onAction("open")}>Open project</button>
            </div>
        </div>
    </section>;
}

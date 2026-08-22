import { getStartupProjectReadiness } from "../../../../front/js/features/diagnostics/startupStatus.js";
import StartupStatusPanel from "./StartupStatusPanel.jsx";

// The welcome surface intentionally has three type scales: page title,
// normal reading copy and auxiliary status detail.  Keeping them explicit
// prevents legacy welcome CSS from making startup alerts disproportionately
// large or reducing status rows to microtext.
const WELCOME_TYPE = Object.freeze({
    title: "!font-sans !text-[clamp(32px,5vw,42px)] !leading-[1.1]",
    normal: "!font-sans !text-[16px] !leading-[1.5]",
    auxiliary: "!font-sans !text-[13px] !leading-[1.4]"
});

const actionButtonClass = "!min-w-0 !flex-1 !rounded-[11px] !border !border-[#168fff] !bg-[#051224a3] !px-[14px] !py-4 !font-sans !text-[16px] !leading-[1.25] !font-semibold !text-white !cursor-pointer !transition-[transform,background] hover:!-translate-y-0.5 hover:!bg-[#155cb45c] disabled:!cursor-not-allowed disabled:!opacity-[.52] disabled:hover:!translate-y-0 disabled:hover:!bg-[#051224a3]";

function RuntimeFailureNotice() {
    return <div className={`mt-5 grid gap-2 rounded-xl border border-[#ff7171ad] bg-[#71141e75] p-[14px] text-left text-[#ffd8d8] ${WELCOME_TYPE.normal}`} role="alert">
        <strong className="text-white">El visor no se pudo iniciar.</strong>
        <span className={WELCOME_TYPE.auxiliary}>Recarga la aplicación para volver a intentarlo.</span>
        <button className={`!mt-0.5 !w-fit !rounded-lg !border !border-[#ffb5b5b3] !bg-[#480f17cc] !px-[11px] !py-2 !text-white !cursor-pointer hover:!bg-[#641721] ${WELCOME_TYPE.auxiliary}`} type="button" onClick={() => window.location.reload()}>Recargar aplicación</button>
    </div>;
}

function preparationCopy(phase, progress) {
    if (phase === "verified-cache") {
        return "Comprobando los datos locales ya validados antes de habilitar los proyectos.";
    }
    if (phase === "awaiting-snapshot") {
        return "Conectando con Orbit para comprobar el estado de los datos locales.";
    }
    if (progress?.state === "downloading") {
        return "Orbit está descargando y validando los datos necesarios antes de permitir crear o abrir un proyecto.";
    }
    if (progress?.state === "validating") {
        return "Orbit está validando los datos necesarios antes de permitir crear o abrir un proyecto.";
    }
    return "Orbit está comprobando y preparando los datos necesarios antes de permitir crear o abrir un proyecto.";
}

export default function ProjectWelcome({ onAction, runtimeStatus, startup, startupPresentation, projectHub = null }) {
    const runtimeFailed = runtimeStatus?.state === "failed";
    const readiness = getStartupProjectReadiness(startup);
    // `startupPresentation` adds the authoritative-snapshot and minimum
    // display requirements.  Its absence must remain fail-closed for older
    // callers rather than briefly exposing project actions from a stale
    // browser-side startup event.
    const preparing = !readiness.ready || startupPresentation?.isPreparing !== false;
    const authoritativeSnapshot = startupPresentation?.authoritativeSnapshot === true;
    const phase = startupPresentation?.phase || "awaiting-snapshot";
    const actionsDisabled = runtimeFailed;

    return <section
        id="projectWelcome"
        className="react-project-welcome !fixed !inset-0 !z-[10500] !grid !place-items-center !overflow-hidden !bg-[#020811] !p-5"
        aria-label="Bienvenida de Orbit"
    >
        <img className="absolute inset-0 h-full w-full object-cover" src="/assets/fonts/fondo.png" alt="" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#020811]/[.06] to-[#020811]/[.22]" aria-hidden="true" />
        <div className={`relative z-10 max-h-[calc(100dvh-40px)] ${preparing ? "w-[min(620px,calc(100vw-40px))]" : projectHub ? "w-[min(900px,calc(100vw-40px))]" : "w-[min(510px,calc(100vw-40px))]"} overflow-y-auto rounded-[30px] border border-[#71a9e694] bg-[linear-gradient(135deg,rgba(9,40,77,.91),rgba(3,13,27,.88))] px-[42px] pt-[54px] pb-11 text-center shadow-[0_32px_90px_rgba(0,0,0,.58)] [scrollbar-color:#426589_transparent] [scrollbar-width:thin] max-[520px]:px-6 max-[520px]:pt-9`}>
            <div className="mx-auto h-[76px] w-[100px] bg-[url('/assets/icon/favicon.svg')] bg-center bg-[length:96%] bg-no-repeat saturate-[1.15] drop-shadow-[0_0_18px_rgba(23,155,255,.5)]" aria-hidden="true" />
            <div className={`mt-[30px] font-extrabold tracking-[10px] text-[#2888ff] ${WELCOME_TYPE.auxiliary}`}>O R B I T</div>
            <h1 className={`!mt-[30px] !mb-[18px] !font-semibold !text-white ${WELCOME_TYPE.title}`}>{preparing ? "Preparando Orbit" : projectHub ? "Tus proyectos" : "Welcome to Orbit"}</h1>
            <div className="mx-auto mb-[27px] h-[3px] w-16 rounded-lg bg-[#168fff] shadow-[0_0_14px_rgba(22,143,255,.6)]" />
            {preparing ? <section className="text-left" data-testid="startup-preparing-view" aria-label="Preparando Orbit">
                <p className={`!m-0 !mb-5 text-center font-normal text-[#b9c9df] ${WELCOME_TYPE.normal}`} data-testid="startup-preparation-copy">{preparationCopy(phase, startup?.progress)}</p>
                {runtimeFailed && <RuntimeFailureNotice />}
                <StartupStatusPanel startup={startup} authoritative={authoritativeSnapshot} presentationPhase={phase} />
                {!runtimeFailed && <p className={`!mt-4 !mb-0 text-center text-[#9eb6d4] ${WELCOME_TYPE.auxiliary}`}>Este estado se actualiza automáticamente. La escena y el Built-In Test siguen disponibles.</p>}
            </section> : projectHub ? <div className="mx-auto w-full text-left" data-testid="authenticated-project-hub">{projectHub}</div> : <>
                <p className={`!m-0 !font-normal !text-[#b9c9df] ${WELCOME_TYPE.normal}`}>Create a project to start modelling your space operations, or open an existing one.</p>
                {runtimeFailed && <RuntimeFailureNotice />}
                <div className="mt-10 flex justify-center gap-4 max-[480px]:flex-col" data-testid="project-welcome-actions">
                    <button className={`${actionButtonClass} !bg-[linear-gradient(135deg,#168fff,#1046bc)] !shadow-[0_12px_26px_rgba(10,93,219,.32)]`} type="button" disabled={actionsDisabled} onClick={() => onAction("new")}>New project</button>
                    <button className={actionButtonClass} type="button" disabled={actionsDisabled} onClick={() => onAction("open")}>Open project</button>
                </div>
            </>}
        </div>
    </section>;
}

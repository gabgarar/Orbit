import {
    SIMULATION_MODE_RANGE,
    SIMULATION_MODE_REALTIME,
    SIMULATION_MODE_STATIC
} from "./simulationState.js";

const SUPPORTED_MODES = new Set([
    SIMULATION_MODE_REALTIME,
    SIMULATION_MODE_RANGE,
    SIMULATION_MODE_STATIC
]);

/**
 * Resolve a requested simulation mode against finite ephemeris domains.
 *
 * OEM and SP3 inputs are sampled products with an explicit coverage window;
 * neither has a valid wall-clock "now" nor an unbounded static horizon.
 * They therefore require the project timeline to stay in Range mode.  This
 * deliberately returns structured facts rather than a translated sentence so
 * every UI surface can present the same policy in its own language.
 */
export function resolveSimulationModeRequest(requestedMode, {
    hasOemDomain = false,
    hasSp3Domain = false,
    hasManualDomain = false
} = {}) {
    const requested = SUPPORTED_MODES.has(requestedMode)
        ? requestedMode
        : SIMULATION_MODE_REALTIME;
    const finiteSources = [
        ...(hasOemDomain ? ["OEM"] : []),
        ...(hasSp3Domain ? ["SP3"] : []),
        ...(hasManualDomain ? ["órbita manual"] : [])
    ];
    const finiteDomainActive = finiteSources.length > 0;
    const isFiniteDomainIncompatibleMode = requested === SIMULATION_MODE_REALTIME
        || requested === SIMULATION_MODE_STATIC;

    if (finiteDomainActive && isFiniteDomainIncompatibleMode) {
        return {
            mode: SIMULATION_MODE_RANGE,
            requestedMode: requested,
            restricted: true,
            reason: "finite-ephemeris-domain",
            finiteSources
        };
    }

    return {
        mode: requested,
        requestedMode: requested,
        restricted: false,
        reason: null,
        finiteSources
    };
}

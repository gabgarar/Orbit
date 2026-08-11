import { spawn } from "node:child_process";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const DEFAULT_RECOVERY_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000]);
export const PYTHON_RELOAD_TIMEOUT_MS = 10_000;
// Rehydrating a validated precise-GNSS product performs the same strict SP3,
// ERP and checksum work as an import.  Give that deterministic local work a
// realistic window rather than killing Uvicorn after the old 10-second poll.
export const PYTHON_STARTUP_POLL_INTERVAL_MS = 250;
export const PYTHON_STARTUP_TIMEOUT_MS = 60_000;
export const PYTHON_STARTUP_ATTEMPTS = Math.ceil(
    PYTHON_STARTUP_TIMEOUT_MS / PYTHON_STARTUP_POLL_INTERVAL_MS
);

function resolveRecoveryDelays(delays) {
    const configuredDelays = Array.isArray(delays) ? delays : DEFAULT_RECOVERY_DELAYS_MS;
    const validDelays = configuredDelays
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
    return validDelays.length ? validDelays : DEFAULT_RECOVERY_DELAYS_MS;
}

export function createPythonBackend({
    client,
    pythonDir,
    backendUrl = "http://127.0.0.1:8765",
    logger = console,
    spawnImpl = spawn,
    platform = process.platform,
    environment = process.env,
    sleep = delay,
    startupAttempts = PYTHON_STARTUP_ATTEMPTS,
    startupDelayMs = PYTHON_STARTUP_POLL_INTERVAL_MS,
    recoveryDelaysMs = DEFAULT_RECOVERY_DELAYS_MS,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
}) {
    const recoveryDelays = resolveRecoveryDelays(recoveryDelaysMs);
    let processHandle = null;
    let ownsProcess = false;
    let processExited = false;
    let startupError = null;
    let startup = null;
    let desiredRunning = false;
    let recoveryTimer = null;
    let recoveryPromise = null;
    let recoveryPending = false;
    let recoveryAttempt = 0;
    // Invalidates callbacks queued by a previous run.  clearTimeout cannot
    // prevent a callback that is already on the event loop from running.
    let recoveryGeneration = 0;
    const intentionalStops = new WeakSet();

    async function isHealthy(options) {
        try {
            return await client.isHealthy(options);
        } catch {
            return false;
        }
    }

    function clearRecoveryTimer() {
        if (recoveryTimer !== null) clearTimeoutImpl(recoveryTimer);
        recoveryTimer = null;
    }

    function stopOwnedProcess(child, signal) {
        if (!ownsProcess || !child || child !== processHandle || child.killed || intentionalStops.has(child)) return;
        intentionalStops.add(child);
        try {
            child.kill(signal);
        } catch (error) {
            logger.warn("Unable to stop Python backend:", error);
        }
    }

    function schedulePendingRecovery() {
        if (!desiredRunning || !recoveryPending || startup || recoveryTimer !== null || recoveryPromise) return;

        const delayIndex = Math.min(recoveryAttempt, recoveryDelays.length - 1);
        const delayMs = recoveryDelays[delayIndex];
        const scheduledGeneration = recoveryGeneration;

        recoveryPending = false;
        // Keep retrying after the initial backoff, but never make the retry
        // cadence faster or allow the counter to grow without bound.
        recoveryAttempt = Math.min(recoveryAttempt + 1, recoveryDelays.length - 1);
        recoveryTimer = setTimeoutImpl(() => {
            recoveryTimer = null;
            if (!desiredRunning || scheduledGeneration !== recoveryGeneration) return undefined;
            const recovery = recoverOwnedProcess(scheduledGeneration);
            recoveryPromise = recovery;
            return recovery;
        }, delayMs);
    }

    function requestRecovery() {
        if (!desiredRunning) return;
        recoveryPending = true;
        schedulePendingRecovery();
    }

    async function recoverOwnedProcess(generation) {
        try {
            await ensureStarted({ recovery: true, generation });
        } catch (error) {
            logger.warn("Python backend recovery attempt failed:", error);
            if (desiredRunning && generation === recoveryGeneration) recoveryPending = true;
        } finally {
            recoveryPromise = null;
            schedulePendingRecovery();
        }
    }

    function stop(signal = "SIGTERM") {
        desiredRunning = false;
        recoveryPending = false;
        recoveryAttempt = 0;
        recoveryGeneration += 1;
        clearRecoveryTimer();
        stopOwnedProcess(processHandle, signal);
    }

    function describeStartupError(executable, error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Error(`Unable to start Python backend (${executable}): ${message}`);
    }

    function observeProcess(child, executable) {
        child.on?.("error", (error) => {
            if (child !== processHandle) return;
            startupError = error;
            logger.error(`Unable to start Python backend (${executable}): ${error.message}`);
        });
        child.on?.("exit", (code, signal) => {
            if (child !== processHandle) return;
            processExited = true;
            const wasIntentional = intentionalStops.has(child);
            processHandle = null;
            ownsProcess = false;
            logger.warn(`Python backend exited (code: ${code ?? "none"}, signal: ${signal ?? "none"}).`);
            if (!wasIntentional) requestRecovery();
        });
        child.stdout?.on("data", (data) => logger.log(`[PYTHON] ${data}`));
        child.stderr?.on("data", (data) => logger.error(`[PYTHON] ${data}`));
    }

    async function startOwnedProcess() {
        const executable = environment.PYTHON_BIN || (platform === "win32" ? "py" : "python3");
        const args = platform === "win32" ? ["-3", "server.py"] : ["server.py"];
        processExited = false;
        startupError = null;
        try {
            processHandle = spawnImpl(executable, args, { cwd: pythonDir });
        } catch (error) {
            processExited = true;
            startupError = error;
            throw describeStartupError(executable, error);
        }
        const child = processHandle;
        ownsProcess = true;
        observeProcess(child, executable);

        for (let attempt = 0; attempt < startupAttempts; attempt += 1) {
            await sleep(startupDelayMs);
            if (await isHealthy()) return;
            if (startupError || processExited || processHandle !== child || child.killed) break;
        }
        stopOwnedProcess(processHandle, "SIGTERM");
        if (startupError) throw describeStartupError(executable, startupError);
        const startupWindowMs = startupAttempts * startupDelayMs;
        throw new Error(
            `Python backend did not become healthy at ${backendUrl}/health within ${startupWindowMs} ms`
        );
    }

    async function ensureStarted({ recovery = false, generation = recoveryGeneration } = {}) {
        if (startup) return startup;
        if (!recovery) {
            if (!desiredRunning) recoveryGeneration += 1;
            desiredRunning = true;
            generation = recoveryGeneration;
        }
        if (recovery && (!desiredRunning || generation !== recoveryGeneration)) return;
        startup = (async () => {
            if (await isHealthy()) {
                logger.log(`Reusing Python backend at ${backendUrl}.`);
                return;
            }
            if (!desiredRunning || generation !== recoveryGeneration) return;
            await startOwnedProcess();
        })();
        try {
            await startup;
            recoveryAttempt = 0;
        } catch (error) {
            if (!recovery) {
                desiredRunning = false;
                recoveryPending = false;
                recoveryAttempt = 0;
                recoveryGeneration += 1;
                clearRecoveryTimer();
            }
            throw error;
        } finally {
            startup = null;
            schedulePendingRecovery();
        }
    }

    async function reload(options = {}) {
        const signal = options?.signal;
        if (signal?.aborted || !(await isHealthy({ signal })) || signal?.aborted) return false;
        try {
            const response = await client.request("/reload", {
                method: "POST",
                headers: { Accept: "application/json" },
                signal,
                timeoutMs: PYTHON_RELOAD_TIMEOUT_MS
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    return { ensureStarted, reload, stop, isHealthy };
}

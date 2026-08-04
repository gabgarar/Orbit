import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { createPythonBackend, PYTHON_RELOAD_TIMEOUT_MS } from "../../src/runtime/python-backend.js";

function childProcess() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = (signal) => { child.killed = true; child.emit("exit", 0, signal); };
    return child;
}

const logger = { log: () => {}, warn: () => {}, error: () => {} };

test("Python supervisor reload forwards cancellation and uses a bounded timeout", async () => {
    const controller = new AbortController();
    const requests = [];
    const backend = createPythonBackend({
        client: {
            isHealthy: async ({ signal }) => signal === controller.signal,
            request: async (path, options) => {
                requests.push({ path, options });
                return { ok: true };
            }
        },
        pythonDir: "/app/server/python",
        logger
    });

    assert.equal(await backend.reload({ signal: controller.signal }), true);
    assert.deepEqual(requests, [{
        path: "/reload",
        options: {
            method: "POST",
            headers: { Accept: "application/json" },
            signal: controller.signal,
            timeoutMs: PYTHON_RELOAD_TIMEOUT_MS
        }
    }]);
    assert.ok(PYTHON_RELOAD_TIMEOUT_MS > 0 && PYTHON_RELOAD_TIMEOUT_MS <= 30_000);
});

test("Python supervisor skips a reload already cancelled by its caller", async () => {
    const controller = new AbortController();
    controller.abort();
    let healthChecks = 0;
    let requests = 0;
    const backend = createPythonBackend({
        client: {
            isHealthy: async () => { healthChecks += 1; return true; },
            request: async () => { requests += 1; return { ok: true }; }
        },
        pythonDir: "/app/server/python",
        logger
    });

    assert.equal(await backend.reload({ signal: controller.signal }), false);
    assert.equal(healthChecks, 0);
    assert.equal(requests, 0);
});

test("Python supervisor reuses an already healthy backend", async () => {
    let spawnCalls = 0;
    const backend = createPythonBackend({
        client: { isHealthy: async () => true },
        pythonDir: "/app/server/python",
        logger,
        spawnImpl: () => { spawnCalls += 1; return childProcess(); }
    });
    await backend.ensureStarted();
    assert.equal(spawnCalls, 0);
});

test("Python supervisor waits for its owned process and stops it cleanly", async () => {
    const health = [false, false, true];
    const child = childProcess();
    const backend = createPythonBackend({
        client: { isHealthy: async () => health.shift() ?? true },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        sleep: async () => {},
        spawnImpl: (command, args, options) => {
            assert.equal(command, "python3");
            assert.deepEqual(args, ["server.py"]);
            assert.deepEqual(options, { cwd: "/app/server/python" });
            return child;
        }
    });
    await Promise.all([backend.ensureStarted(), backend.ensureStarted()]);
    backend.stop("SIGTERM");
    assert.equal(child.killed, true);
});

test("Python supervisor fails fast when its child process cannot start", async () => {
    const child = childProcess();
    let sleepCalls = 0;
    let healthChecks = 0;
    const backend = createPythonBackend({
        client: {
            isHealthy: async () => {
                healthChecks += 1;
                return false;
            }
        },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        startupAttempts: 40,
        sleep: async () => {
            sleepCalls += 1;
            child.emit("error", new Error("spawn python3 ENOENT"));
        },
        spawnImpl: () => child
    });

    await assert.rejects(
        backend.ensureStarted(),
        /Unable to start Python backend \(python3\): spawn python3 ENOENT/
    );
    assert.equal(sleepCalls, 1);
    assert.equal(healthChecks, 2);
});

test("Python supervisor ignores an exit from a replaced child process", async () => {
    const firstChild = childProcess();
    const secondChild = childProcess();
    const health = [false, false, false, false, true];
    let sleepCalls = 0;
    const backend = createPythonBackend({
        client: { isHealthy: async () => health.shift() ?? true },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        startupAttempts: 2,
        sleep: async () => {
            sleepCalls += 1;
            if (sleepCalls === 1) firstChild.emit("error", new Error("first process failed"));
            if (sleepCalls === 2) firstChild.emit("exit", 1, null);
        },
        spawnImpl: (() => {
            const children = [firstChild, secondChild];
            return () => children.shift();
        })()
    });

    await assert.rejects(backend.ensureStarted(), /first process failed/);
    await backend.ensureStarted();
    assert.equal(sleepCalls, 3);
});

test("Python supervisor restarts its owned backend after an unexpected exit", async () => {
    const firstChild = childProcess();
    const secondChild = childProcess();
    const timers = [];
    const health = [false, true, false, true];
    let spawnCalls = 0;
    const backend = createPythonBackend({
        client: { isHealthy: async () => health.shift() ?? true },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        sleep: async () => {},
        recoveryDelaysMs: [25],
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        spawnImpl: () => [firstChild, secondChild][spawnCalls++]
    });

    await backend.ensureStarted();
    firstChild.emit("exit", 1, null);

    assert.deepEqual(timers.map((timer) => timer.delay), [25]);
    await timers[0].callback();

    assert.equal(spawnCalls, 2);
    assert.equal(secondChild.killed, false);
});

test("Python supervisor cancels a pending recovery when stopped intentionally", async () => {
    const firstChild = childProcess();
    const secondChild = childProcess();
    const timers = [];
    const clearedTimers = [];
    let spawnCalls = 0;
    const backend = createPythonBackend({
        client: { isHealthy: async () => [false, true][Math.min(spawnCalls, 1)] },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        sleep: async () => {},
        recoveryDelaysMs: [25],
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        clearTimeoutImpl: (timer) => clearedTimers.push(timer),
        spawnImpl: () => [firstChild, secondChild][spawnCalls++]
    });

    await backend.ensureStarted();
    firstChild.emit("exit", 1, null);
    assert.equal(timers.length, 1);
    backend.stop();
    assert.deepEqual(clearedTimers, [timers[0]]);
    await timers[0].callback();
    assert.equal(spawnCalls, 1);
});

test("Python supervisor does not queue another recovery when stopped during one", async () => {
    const firstChild = childProcess();
    const secondChild = childProcess();
    const timers = [];
    let releaseRecoverySleep;
    let holdRecovery = false;
    let spawnCalls = 0;
    const health = [false, true, false, false];
    const backend = createPythonBackend({
        client: { isHealthy: async () => health.shift() ?? false },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        sleep: () => {
            if (!holdRecovery) return Promise.resolve();
            return new Promise((resolve) => { releaseRecoverySleep = resolve; });
        },
        recoveryDelaysMs: [25],
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        spawnImpl: () => [firstChild, secondChild][spawnCalls++]
    });

    await backend.ensureStarted();
    firstChild.emit("exit", 1, null);
    holdRecovery = true;
    const recovering = timers[0].callback();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(spawnCalls, 2);

    backend.stop();
    releaseRecoverySleep();
    await recovering;

    assert.equal(secondChild.killed, true);
    assert.equal(timers.length, 1);
});

test("Python supervisor does not recover an initial failed startup automatically", async () => {
    const child = childProcess();
    const timers = [];
    const backend = createPythonBackend({
        client: { isHealthy: async () => false },
        pythonDir: "/app/server/python",
        logger,
        platform: "linux",
        startupAttempts: 1,
        sleep: async () => child.emit("exit", 1, null),
        recoveryDelaysMs: [25],
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        spawnImpl: () => child
    });

    await assert.rejects(backend.ensureStarted(), /did not become healthy/);
    assert.deepEqual(timers, []);
});

test("Python supervisor keeps recovering at its bounded maximum retry cadence", async () => {
    const children = [childProcess(), childProcess(), childProcess(), childProcess()];
    const timers = [];
    const errors = [];
    const health = [false, true, false, false, false, false, false, false, true];
    let spawnCalls = 0;
    const backend = createPythonBackend({
        client: { isHealthy: async () => health.shift() ?? false },
        pythonDir: "/app/server/python",
        logger: { log: () => {}, warn: () => {}, error: (message) => errors.push(message) },
        platform: "linux",
        startupAttempts: 1,
        sleep: async () => {
            if (spawnCalls > 1) children[spawnCalls - 1].emit("exit", 1, null);
        },
        recoveryDelaysMs: [10, 20],
        setTimeoutImpl: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        spawnImpl: () => children[spawnCalls++]
    });

    await backend.ensureStarted();
    children[0].emit("exit", 1, null);
    await timers[0].callback();
    await timers[1].callback();
    await timers[2].callback();
    await timers[3].callback();

    assert.equal(spawnCalls, 4);
    assert.deepEqual(timers.map((timer) => timer.delay), [10, 20, 20, 20]);
    assert.deepEqual(errors, []);
});

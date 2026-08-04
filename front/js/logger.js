const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100
};

const loggerConfig = {
    enabled: true,
    level: "info"
};

function normalizeLevel(level) {
    const raw = typeof level === "string" ? level.toLowerCase() : "info";
    return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? raw : "info";
}

function shouldLog(level) {
    if (!loggerConfig.enabled) {
        return false;
    }
    const current = LEVELS[normalizeLevel(loggerConfig.level)];
    const requested = LEVELS[normalizeLevel(level)];
    return requested >= current;
}

function formatPrefix(scope, level) {
    const ts = new Date().toISOString();
    return `[${ts}] [${level.toUpperCase()}]${scope ? ` [${scope}]` : ""}`;
}

function toConsoleMethod(level) {
    if (level === "debug") return console.debug;
    if (level === "warn") return console.warn;
    if (level === "error") return console.error;
    return console.log;
}

export function configureLogger(systemConfig = {}) {
    if (typeof systemConfig.log_enabled === "boolean") {
        loggerConfig.enabled = systemConfig.log_enabled;
    }

    if (typeof systemConfig.log_level === "string") {
        loggerConfig.level = normalizeLevel(systemConfig.log_level);
    }
}

export function getLogger(scope = "") {
    return {
        debug: (...args) => {
            if (!shouldLog("debug")) return;
            toConsoleMethod("debug")(formatPrefix(scope, "debug"), ...args);
        },
        info: (...args) => {
            if (!shouldLog("info")) return;
            toConsoleMethod("info")(formatPrefix(scope, "info"), ...args);
        },
        warn: (...args) => {
            if (!shouldLog("warn")) return;
            toConsoleMethod("warn")(formatPrefix(scope, "warn"), ...args);
        },
        error: (...args) => {
            if (!shouldLog("error")) return;
            toConsoleMethod("error")(formatPrefix(scope, "error"), ...args);
        }
    };
}

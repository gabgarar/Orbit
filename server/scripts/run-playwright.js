import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.dirname(scriptsDir);
const nodeModulesDir = path.join(serverDir, "node_modules");
const playwrightCli = require.resolve("@playwright/test/cli");
const nodePath = [nodeModulesDir, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);

const child = spawn(process.execPath, [playwrightCli, "test", "--config=playwright.config.js", ...process.argv.slice(2)], {
    cwd: serverDir,
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: nodePath }
});

const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
});

process.exitCode = exitCode;

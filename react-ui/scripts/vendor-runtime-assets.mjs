import { access, copyFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import {
    cesiumVendorDirectory,
    pakoVendorFile,
    reactUiDirectory,
    runtimeVendorDirectory
} from "./runtime-vendor-paths.mjs";

const execFile = promisify(execFileCallback);

function npmInvocation() {
    if (process.env.npm_execpath) {
        return { command: process.execPath, prefix: [process.env.npm_execpath] };
    }
    if (process.platform === "win32") {
        // `execFile("npm.cmd")` is not a reliable Windows process launch: on
        // Node 24 it can reject with EINVAL before npm gets a chance to run.
        // Invoke npm's JavaScript entry point through the active Node runtime
        // instead. This keeps `npm pack` argument-safe (no shell) and lets a
        // direct `node scripts/vendor-runtime-assets.mjs` work just like an
        // invocation from `npm run build`.
        const npmCli = path.join(
            path.dirname(process.execPath),
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js"
        );
        return { command: process.execPath, prefix: [npmCli] };
    }
    return { command: "npm", prefix: [] };
}

async function readRuntimePackages() {
    const manifestPath = path.join(reactUiDirectory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const dependencies = manifest.orbitRuntimeDependencies;
    if (!dependencies || typeof dependencies.cesium !== "string" || typeof dependencies.pako !== "string") {
        throw new Error("react-ui/package.json must declare exact orbitRuntimeDependencies for cesium and pako.");
    }
    if (!/^\d+\.\d+\.\d+$/.test(dependencies.cesium) || !/^\d+\.\d+\.\d+$/.test(dependencies.pako)) {
        throw new Error("Orbit runtime dependencies must use exact npm versions without ranges.");
    }
    return dependencies;
}

async function packPackage(specification, destination, cacheDirectory) {
    const npm = npmInvocation();
    let stdout;
    try {
        ({ stdout } = await execFile(npm.command, [
            ...npm.prefix,
            "pack",
            specification,
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            destination,
            "--prefer-offline",
            "--cache",
            cacheDirectory,
            "--loglevel=error"
        ], { cwd: reactUiDirectory }));
    } catch (error) {
        throw new Error(
            `Unable to download pinned runtime package ${specification} with npm pack. ` +
            "Check npm registry access and retry the Orbit frontend build.",
            { cause: error }
        );
    }
    let packed;
    try {
        packed = JSON.parse(stdout);
    } catch (error) {
        throw new Error(`npm pack returned invalid JSON for ${specification}.`, { cause: error });
    }
    const filename = packed?.[0]?.filename;
    if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
        throw new Error(`npm pack did not produce a tarball for ${specification}.`);
    }
    return path.join(destination, filename);
}

async function extractTarball(tarball, destination) {
    await mkdir(destination, { recursive: true });
    await execFile("tar", ["-xzf", tarball, "-C", destination]);
    return path.join(destination, "package");
}

async function requirePath(filePath, label) {
    try {
        await access(filePath);
    } catch {
        throw new Error(`${label} was not found in the pinned npm package.`);
    }
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "orbit-runtime-vendor-"));
try {
    const versions = await readRuntimePackages();
    const npmCacheDirectory = path.join(temporaryDirectory, "npm-cache");
    const cesiumTarball = await packPackage(
        `cesium@${versions.cesium}`,
        temporaryDirectory,
        npmCacheDirectory
    );
    const pakoTarball = await packPackage(
        `pako@${versions.pako}`,
        temporaryDirectory,
        npmCacheDirectory
    );
    const [cesiumPackageDirectory, pakoPackageDirectory] = await Promise.all([
        extractTarball(cesiumTarball, path.join(temporaryDirectory, "cesium")),
        extractTarball(pakoTarball, path.join(temporaryDirectory, "pako"))
    ]);
    const cesiumBuildDirectory = path.join(cesiumPackageDirectory, "Build", "Cesium");
    const pakoBuildFile = path.join(pakoPackageDirectory, "dist", "pako.min.js");
    await Promise.all([
        requirePath(path.join(cesiumBuildDirectory, "Cesium.js"), "Cesium Build/Cesium"),
        requirePath(path.join(cesiumBuildDirectory, "Assets"), "Cesium assets"),
        requirePath(path.join(cesiumBuildDirectory, "Workers"), "Cesium workers"),
        requirePath(path.join(cesiumBuildDirectory, "Widgets", "widgets.css"), "Cesium widgets stylesheet"),
        requirePath(pakoBuildFile, "pako dist/pako.min.js")
    ]);

    await rm(runtimeVendorDirectory, { recursive: true, force: true });
    await Promise.all([
        cp(cesiumBuildDirectory, cesiumVendorDirectory, { recursive: true, force: true }),
        mkdir(path.dirname(pakoVendorFile), { recursive: true })
    ]);
    await copyFile(pakoBuildFile, pakoVendorFile);
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

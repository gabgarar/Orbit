import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeFileAtomically(filePath, content, { fileSystem = fs } = {}) {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
        await fileSystem.writeFile(temporaryPath, content, "utf8");
        await fileSystem.rename(temporaryPath, filePath);
    } catch (error) {
        await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
    }
}

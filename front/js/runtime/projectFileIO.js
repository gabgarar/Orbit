export function serializeProjectDocument(projectDocument) {
    return JSON.stringify(projectDocument, null, 2);
}

export async function readProjectDocument(file) {
    return JSON.parse(await file.text());
}

export async function saveProjectDocument(handle, projectDocument) {
    const writable = await handle.createWritable();
    await writable.write(serializeProjectDocument(projectDocument));
    await writable.close();
}

export function downloadProjectDocument(projectDocument, {
    documentRef = globalThis.document,
    urlApi = URL,
    fileName = "orbit-project.json"
} = {}) {
    const blob = new Blob([serializeProjectDocument(projectDocument)], { type: "application/json" });
    const url = urlApi.createObjectURL(blob);
    const anchor = Object.assign(documentRef.createElement("a"), { href: url, download: fileName });
    anchor.click();
    urlApi.revokeObjectURL(url);
}

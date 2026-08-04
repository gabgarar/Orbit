import { getExportNoradId } from "./identity.js";

const XML_ENTITIES = Object.freeze({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
});

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);
}

function sourceFormat(entry) {
    return entry?.sourceFormat || "TLE";
}

function normalizedPropagator(propagator) {
    return String(propagator || "sgp4").trim().toLowerCase();
}

export function formatCatalogEntryToTleText(entry) {
    return `${entry.name}\n${entry.line1}\n${entry.line2}\n`;
}

export function formatCatalogEntryToOmmJson(entry) {
    return JSON.stringify({
        OBJECT_NAME: entry.name,
        OBJECT_ID: entry.name,
        TLE_LINE1: entry.line1,
        TLE_LINE2: entry.line2,
        NORAD_CAT_ID: getExportNoradId(entry),
        SOURCE_FORMAT: sourceFormat(entry)
    }, null, 2);
}

export function formatCatalogEntryToOmmXml(entry) {
    const name = escapeXml(entry.name);
    const line1 = escapeXml(entry.line1);
    const line2 = escapeXml(entry.line2);
    const noradId = escapeXml(getExportNoradId(entry));

    return `<?xml version="1.0" encoding="UTF-8"?>
<ndm>
  <omm version="2.0">
    <body>
      <segment>
        <metadata>
          <OBJECT_NAME>${name}</OBJECT_NAME>
          <OBJECT_ID>${name}</OBJECT_ID>
        </metadata>
        <data>
          <tleParameters>
            <TLE_LINE1>${line1}</TLE_LINE1>
            <TLE_LINE2>${line2}</TLE_LINE2>
            <NORAD_CAT_ID>${noradId}</NORAD_CAT_ID>
          </tleParameters>
        </data>
      </segment>
    </body>
  </omm>
</ndm>
`;
}

export function formatCatalogEntryToOcm(entry) {
    return JSON.stringify({
        format: "OCM",
        object: {
            name: entry.name,
            norad_id: getExportNoradId(entry),
            source_format: sourceFormat(entry)
        },
        mean_elements_source: {
            line1: entry.line1,
            line2: entry.line2
        },
        generatedAt: new Date().toISOString()
    }, null, 2);
}

export function formatCatalogEntryToOem(entry, propagator = "sgp4") {
    const name = String(entry?.name || "UNKNOWN").trim();
    const line1 = String(entry?.line1 || "").trim();
    const line2 = String(entry?.line2 || "").trim();

    return [
        "CCSDS_OEM_VERS = 2.0",
        `CREATION_DATE = ${new Date().toISOString()}`,
        "ORIGINATOR = Orbit",
        `COMMENT = SOURCE_FORMAT ${String(sourceFormat(entry)).toUpperCase()}`,
        `COMMENT = PROPAGATOR ${normalizedPropagator(propagator)}`,
        "META_START",
        `OBJECT_NAME = ${name}`,
        `OBJECT_ID = ${name}`,
        "CENTER_NAME = EARTH",
        "REF_FRAME = TEME",
        "TIME_SYSTEM = UTC",
        "META_STOP",
        `COMMENT = TLE_LINE1 ${line1}`,
        `COMMENT = TLE_LINE2 ${line2}`,
        ""
    ].join("\n");
}

export function isEntrySourceFormat(entry, expected) {
    return String(sourceFormat(entry)).trim().toUpperCase() === String(expected || "").trim().toUpperCase();
}

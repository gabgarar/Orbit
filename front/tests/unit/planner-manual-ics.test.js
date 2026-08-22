import assert from "node:assert/strict";
import test from "node:test";

import {
    MANUAL_PLANNER_ICS_MAX_BYTES,
    MANUAL_PLANNER_SYNC_STATUS,
    createManualPlannerSyncAdapter,
    escapeManualPlannerIcsText,
    getManualPlannerSyncCapabilities,
    parseManualPlannerEventsIcs,
    serializeManualPlannerEventsToIcs,
    unescapeManualPlannerIcsText
} from "../../js/features/planner/manualPlannerIcs.js";
import { PLANNER_EVENT_KINDS } from "../../js/features/planner/plannerEvents.js";

const START = "2026-08-22T10:00:00.000Z";
const END = "2026-08-22T11:30:00.000Z";

function manual(id, overrides = {}) {
    return {
        id,
        kind: PLANNER_EVENT_KINDS.MANUAL,
        title: "Revisión de maniobra",
        start: START,
        end: END,
        colorToken: "purple",
        metadata: { description: "Comprobar estación A\nConfirmar ventana." },
        ...overrides
    };
}

test("manual ICS round trip preserves only authored planner fields", () => {
    const output = serializeManualPlannerEventsToIcs([
        manual("manual:review"),
        {
            id: "pass:derived",
            kind: PLANNER_EVENT_KINDS.PASS_AOS,
            title: "AOS derivado",
            time: START
        }
    ], {
        calendarName: "Plan de misión",
        generatedAt: "2026-08-01T00:00:00.000Z"
    });

    assert.match(output, /BEGIN:VCALENDAR\r\nVERSION:2\.0/);
    assert.match(output, /X-WR-CALNAME:Plan de misión/);
    assert.match(output, /DTSTAMP:20260801T000000Z/);
    assert.match(output, /X-ORBIT-EVENT-ID:manual:review/);
    assert.equal((output.match(/BEGIN:VEVENT/g) || []).length, 1, "derived passes never leave the project as editable calendar records");

    const parsed = parseManualPlannerEventsIcs(output);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.rejected, 0);
    assert.deepEqual(parsed.events.map((event) => ({
        id: event.id,
        kind: event.kind,
        title: event.title,
        start: event.start,
        end: event.end,
        colorToken: event.colorToken,
        description: event.metadata.description
    })), [{
        id: "manual:review",
        kind: "manual",
        title: "Revisión de maniobra",
        start: START,
        end: END,
        colorToken: "purple",
        description: "Comprobar estación A\nConfirmar ventana."
    }]);
});

test("ICS text escaping prevents a manual note from creating properties", () => {
    const source = "Línea 1;coma,barra\\\nLínea 2";
    const escaped = escapeManualPlannerIcsText(source);
    assert.equal(escaped, "Línea 1\\;coma\\,barra\\\\\\nLínea 2");
    assert.equal(unescapeManualPlannerIcsText(escaped), source);

    const output = serializeManualPlannerEventsToIcs([manual("manual:injection", {
        title: "Prueba\r\nBEGIN:VEVENT",
        metadata: { description: "Nota\r\nX-ORBIT-COLOR:rose" }
    })], { generatedAt: START });
    assert.equal((output.match(/(?:^|\r\n)BEGIN:VEVENT\r\n/g) || []).length, 1);
    assert.match(output, /SUMMARY:Prueba BEGIN:VEVENT/);
    assert.match(output, /DESCRIPTION:Nota\\nX-ORBIT-COLOR:rose/);
});

test("ICS import rejects local-zone ambiguity, malformed records and cancellation without deleting anything", () => {
    const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:local-zone",
        "DTSTART;TZID=Europe/Madrid:20260822T100000",
        "DTEND;TZID=Europe/Madrid:20260822T110000",
        "SUMMARY:No UTC",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:cancelled",
        "DTSTART:20260822T100000Z",
        "DTEND:20260822T110000Z",
        "SUMMARY:Cancelar entrada local",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:valid",
        "DTSTART:20260822T100000Z",
        "DTEND:20260822T113000Z",
        "SUMMARY:Entrada válida",
        "X-ORBIT-COLOR:cyan",
        "END:VEVENT",
        "END:VCALENDAR",
        ""
    ].join("\r\n");
    const parsed = parseManualPlannerEventsIcs(calendar);
    assert.equal(parsed.ok, true, "a valid record can be imported despite rejected neighbours");
    assert.equal(parsed.events.length, 1);
    assert.equal(parsed.events[0].title, "Entrada válida");
    assert.equal(parsed.events[0].colorToken, "cyan");
    assert.equal(parsed.rejected, 2);
    assert.match(parsed.errors.join("\n"), /zona horaria/);
    assert.match(parsed.errors.join("\n"), /cancelado/);
});

test("ICS parser is bounded and only accepts a closed calendar", () => {
    const oversized = `BEGIN:VCALENDAR\r\n${"A".repeat(MANUAL_PLANNER_ICS_MAX_BYTES)}\r\nEND:VCALENDAR`;
    const tooLarge = parseManualPlannerEventsIcs(oversized);
    assert.equal(tooLarge.ok, false);
    assert.equal(tooLarge.events.length, 0);
    assert.match(tooLarge.errors[0], /tamaño máximo/i);

    const open = parseManualPlannerEventsIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Incompleto");
    assert.equal(open.ok, false);
    assert.equal(open.events.length, 0);
    assert.match(open.errors.join("\n"), /cerrado correctamente/i);
});

test("ICS import cannot claim an authoritative derived-event identifier", () => {
    const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:external-1",
        "DTSTART:20260822T100000Z",
        "DTEND:20260822T110000Z",
        "SUMMARY:Entrada externa",
        "X-ORBIT-EVENT-ID:pass:authoritative-aos",
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\r\n");
    const parsed = parseManualPlannerEventsIcs(calendar);
    assert.equal(parsed.ok, true);
    assert.match(parsed.events[0].id, /^manual-ics:/);
    assert.notEqual(parsed.events[0].id, "pass:authoritative-aos");
});

test("sync adapter exposes import/export now and fails remote actions explicitly without network", () => {
    const capabilities = getManualPlannerSyncCapabilities({
        linkageState: "google_linked",
        syncPreference: "sync_enabled"
    });
    assert.deepEqual(capabilities, {
        status: "local-only",
        localIcsImport: true,
        localIcsExport: true,
        remoteSync: false,
        linkedProvider: "google",
        remoteRequested: true,
        reason: "La sincronización remota requiere un adaptador autorizado; el proyecto conserva únicamente su preferencia local."
    });

    const projectMetadataCapabilities = getManualPlannerSyncCapabilities({
        project: {
            linkage: { state: "microsoft_linked" },
            modulePolicies: { planner: { syncPreference: { enabled: true, state: "sync_enabled" } } }
        }
    });
    assert.equal(projectMetadataCapabilities.linkedProvider, "microsoft");
    assert.equal(projectMetadataCapabilities.remoteRequested, true);
    assert.equal(projectMetadataCapabilities.remoteSync, false);

    const adapter = createManualPlannerSyncAdapter({
        linkageState: "microsoft_linked",
        syncPreference: "sync_enabled"
    });
    assert.equal(adapter.id, "orbit-local-ics");
    assert.equal(adapter.capabilities.remoteSync, false);
    assert.equal(adapter.importIcs(serializeManualPlannerEventsToIcs([manual("manual:adapter")])).events.length, 1);
    assert.deepEqual(adapter.pull(), {
        ok: false,
        status: MANUAL_PLANNER_SYNC_STATUS.REMOTE_UNAVAILABLE,
        reason: adapter.capabilities.reason
    });
    assert.deepEqual(adapter.push(), adapter.pull());
});

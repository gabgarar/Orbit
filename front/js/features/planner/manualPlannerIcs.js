import {
    PLANNER_COLOR_TOKENS,
    PLANNER_EVENT_KINDS,
    normalizeManualPlannerEvent,
    normalizePlannerEvents,
    plannerIsoTimestamp
} from "./plannerEvents.js";

/**
 * Local-only ICS interchange for authored Planner entries.
 *
 * This deliberately operates on `kind: "manual"` events only.  Passes,
 * source coverage and imported-file notices are runtime facts, so exporting
 * them as an operator calendar would turn them into stale editable data.
 * There is no network access in this module: the sync adapter at the end is
 * an explicit capability boundary for a future, separately authorised
 * transport implementation.
 */

/**
 * MIME type consumed by the React download bridge. The bridge lives outside
 * this legacy runtime's Knip project, so retain this intentional public
 * contract while excluding it from the runtime-only unused-export scan.
 *
 * @lintignore
 */
export const MANUAL_PLANNER_ICS_MIME_TYPE = "text/calendar;charset=utf-8";
export const MANUAL_PLANNER_ICS_MAX_BYTES = 1_048_576;
export const MANUAL_PLANNER_ICS_MAX_EVENTS = 500;
export const MANUAL_PLANNER_ICS_MAX_PHYSICAL_LINES = 12_000;
export const MANUAL_PLANNER_ICS_MAX_LINE_LENGTH = 16_384;

export const MANUAL_PLANNER_SYNC_STATUS = Object.freeze({
    LOCAL_ONLY: "local-only",
    REMOTE_UNAVAILABLE: "remote-unavailable"
});

const ICS_CALENDAR_HEADER = Object.freeze([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Orbit//Planner Manual Events//ES"
]);
const ICS_CALENDAR_FOOTER = "END:VCALENDAR";
const manualColorTokens = new Set(Object.values(PLANNER_COLOR_TOKENS));
const safeEventIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const utf8Encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function utf8Length(value) {
    const source = String(value ?? "");
    if (utf8Encoder) return utf8Encoder.encode(source).length;
    // Every non-ASCII code unit can occupy at most three UTF-8 bytes.  This
    // conservative fallback retains the parser's denial-of-service bound in
    // an unusually old host without a TextEncoder implementation.
    return [...source].reduce((length, character) => length + (character.codePointAt(0) > 0x7f ? 3 : 1), 0);
}

function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function cleanText(value, maximumLength, { singleLine = false } = {}) {
    let result = String(value ?? "")
        .replace(/\u0000/g, "")
        .replace(/\r\n?/g, "\n");
    if (singleLine) result = result.replace(/[\n\t]+/g, " ");
    // Control characters cannot carry useful calendar content and make
    // property-line handling ambiguous. Preserve a description newline only.
    result = result.replace(singleLine ? /[\u0001-\u001f\u007f]/g : /[\u0001-\u0009\u000b-\u001f\u007f]/g, "");
    return result.trim().slice(0, maximumLength);
}

/** Escape RFC5545 TEXT without allowing a value to create another property. */
export function escapeManualPlannerIcsText(value) {
    return cleanText(value, 2_000)
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll(";", "\\;")
        .replaceAll(",", "\\,");
}

/** Decode the limited RFC5545 TEXT escape set used by this module. */
export function unescapeManualPlannerIcsText(value) {
    const source = String(value ?? "");
    let result = "";
    for (let index = 0; index < source.length; index += 1) {
        const current = source[index];
        if (current !== "\\" || index + 1 >= source.length) {
            result += current;
            continue;
        }
        const escaped = source[index + 1];
        index += 1;
        if (escaped === "n" || escaped === "N") result += "\n";
        else if (escaped === "\\" || escaped === ";" || escaped === ",") result += escaped;
        else result += escaped;
    }
    return result;
}

function icsUtcTimestamp(value) {
    const iso = plannerIsoTimestamp(value);
    if (!iso) return null;
    const date = new Date(iso);
    const pad = (part) => String(part).padStart(2, "0");
    return `${String(date.getUTCFullYear()).padStart(4, "0")}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
        + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function foldIcsLine(value) {
    const source = String(value ?? "").replace(/[\r\n]/g, "");
    const physicalLines = [];
    let current = "";
    let currentLength = 0;
    let lineLimit = 75;
    for (const character of source) {
        const characterLength = utf8Length(character);
        if (current && currentLength + characterLength > lineLimit) {
            physicalLines.push(current);
            current = ` ${character}`;
            currentLength = 1 + characterLength;
            lineLimit = 75;
            continue;
        }
        current += character;
        currentLength += characterLength;
    }
    physicalLines.push(current);
    return physicalLines.join("\r\n");
}

function normalizedManualEvents(events) {
    return normalizePlannerEvents(Array.isArray(events) ? events : [])
        .filter((event) => event.kind === PLANNER_EVENT_KINDS.MANUAL);
}

function safeCalendarName(value) {
    return cleanText(value || "Orbit Planner", 120, { singleLine: true }) || "Orbit Planner";
}

function exportedEventId(event) {
    const candidate = text(event?.id);
    return safeEventIdentifier.test(candidate) && /^manual(?:[-.:]|$)/i.test(candidate) ? candidate : "";
}

function deterministicUid(event) {
    return `orbit-${stableHash([event.id, event.title, event.start, event.end].join("\u001f"))}@orbit.local`;
}

/**
 * Serialize only validated manual Planner entries into a UTF-8 ICS calendar.
 * `generatedAt` exists for reproducible exports/tests; when omitted, the
 * export's normal creation time is used solely for `DTSTAMP`.
 */
export function serializeManualPlannerEventsToIcs(events, {
    calendarName = "Orbit Planner",
    generatedAt = new Date()
} = {}) {
    const generatedStamp = icsUtcTimestamp(generatedAt) || icsUtcTimestamp(new Date());
    const lines = [
        ...ICS_CALENDAR_HEADER,
        `X-WR-CALNAME:${escapeManualPlannerIcsText(safeCalendarName(calendarName))}`
    ];
    for (const event of normalizedManualEvents(events)) {
        const start = icsUtcTimestamp(event.start);
        const end = icsUtcTimestamp(event.end);
        if (!start || !end) continue;
        const eventId = exportedEventId(event);
        lines.push(
            "BEGIN:VEVENT",
            `UID:${deterministicUid(event)}`,
            `DTSTAMP:${generatedStamp}`,
            `DTSTART:${start}`,
            `DTEND:${end}`,
            `SUMMARY:${escapeManualPlannerIcsText(cleanText(event.title, 256, { singleLine: true }))}`,
            `X-ORBIT-COLOR:${event.colorToken}`,
            `X-ORBIT-ALL-DAY:${event.allDay ? "TRUE" : "FALSE"}`
        );
        if (eventId) lines.push(`X-ORBIT-EVENT-ID:${eventId}`);
        const description = cleanText(event.metadata?.description ?? event.metadata?.details ?? event.metadata?.detail, 2_000);
        if (description) lines.push(`DESCRIPTION:${escapeManualPlannerIcsText(description)}`);
        lines.push("END:VEVENT");
    }
    lines.push(ICS_CALENDAR_FOOTER);
    return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function parseIcsProperty(line) {
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const left = line.slice(0, separator);
    const [name, ...parameters] = left.split(";");
    const normalizedName = text(name).toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(normalizedName)) return null;
    return {
        name: normalizedName,
        parameters: parameters.map((parameter) => text(parameter).toUpperCase()).filter(Boolean),
        value: line.slice(separator + 1)
    };
}

function parseIcsUtcDateTime(value) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z$/.exec(text(value));
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
    const epoch = Date.UTC(year, month - 1, day, hour, minute, second);
    const date = new Date(epoch);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString();
}

function foldIcsSource(source, limits) {
    if (typeof source !== "string") return { lines: [], errors: ["El calendario ICS debe ser texto UTF-8."], fatal: true };
    if (utf8Length(source) > limits.maxBytes) {
        return { lines: [], errors: ["El calendario ICS supera el tamaño máximo permitido."], fatal: true };
    }
    const physicalLines = source.replace(/\r\n?/g, "\n").split("\n");
    if (physicalLines.length > limits.maxPhysicalLines) {
        return { lines: [], errors: ["El calendario ICS contiene demasiadas líneas."], fatal: true };
    }
    const lines = [];
    for (const physicalLine of physicalLines) {
        if (utf8Length(physicalLine) > limits.maxLineLength) {
            return { lines: [], errors: ["El calendario ICS contiene una línea demasiado larga."], fatal: true };
        }
        if (/^[ \t]/.test(physicalLine) && lines.length) {
            const previous = lines.length - 1;
            lines[previous] += physicalLine.slice(1);
            if (utf8Length(lines[previous]) > limits.maxLineLength) {
                return { lines: [], errors: ["El calendario ICS contiene una línea plegada demasiado larga."], fatal: true };
            }
        } else if (physicalLine) {
            lines.push(physicalLine);
        }
    }
    return { lines, errors: [], fatal: false };
}

function manualIdFromIcs(properties) {
    const orbitId = text(properties["X-ORBIT-EVENT-ID"]);
    // Imported data must never claim an id in a derived planner namespace
    // (for example `pass:`) and then de-duplicate an authoritative event.
    if (safeEventIdentifier.test(orbitId) && /^manual(?:[-.:]|$)/i.test(orbitId)) return orbitId;
    const uid = cleanText(properties.UID, 512, { singleLine: true });
    return `manual-ics:${stableHash(uid || [properties.SUMMARY, properties.DTSTART, properties.DTEND].join("\u001f"))}`;
}

function collectEventProperties(record, property) {
    const allowed = new Set([
        "UID",
        "DTSTART",
        "DTEND",
        "SUMMARY",
        "DESCRIPTION",
        "STATUS",
        "X-ORBIT-COLOR",
        "X-ORBIT-ALL-DAY",
        "X-ORBIT-EVENT-ID"
    ]);
    if (!allowed.has(property.name)) return;
    if (Object.prototype.hasOwnProperty.call(record.properties, property.name)) {
        record.errors.push(`El evento ${record.index} repite la propiedad ${property.name}.`);
        return;
    }
    record.properties[property.name] = property.value;
    if ((property.name === "DTSTART" || property.name === "DTEND") && property.parameters.length) {
        record.errors.push(`El evento ${record.index} usa parámetros de zona horaria no compatibles.`);
    }
}

function normalizeImportedManualEvent(record) {
    const properties = record.properties;
    if (record.errors.length) return { event: null, errors: record.errors };
    if (text(properties.STATUS).toUpperCase() === "CANCELLED") {
        return { event: null, errors: [`El evento ${record.index} está cancelado y no modifica el proyecto local.`] };
    }
    const title = cleanText(unescapeManualPlannerIcsText(properties.SUMMARY), 256, { singleLine: true });
    const start = parseIcsUtcDateTime(properties.DTSTART);
    const end = parseIcsUtcDateTime(properties.DTEND);
    if (!title || !start || !end) {
        return { event: null, errors: [`El evento ${record.index} requiere SUMMARY, DTSTART y DTEND en UTC explícito.`] };
    }
    const colour = text(properties["X-ORBIT-COLOR"]).toLowerCase();
    const description = cleanText(unescapeManualPlannerIcsText(properties.DESCRIPTION), 2_000);
    const candidate = normalizeManualPlannerEvent({
        id: manualIdFromIcs(properties),
        title,
        start,
        end,
        colorToken: manualColorTokens.has(colour) ? colour : PLANNER_COLOR_TOKENS.BLUE,
        allDay: text(properties["X-ORBIT-ALL-DAY"]).toUpperCase() === "TRUE",
        metadata: description ? { description } : {}
    });
    return candidate
        ? { event: candidate, errors: [] }
        : { event: null, errors: [`El evento ${record.index} no define un intervalo manual válido.`] };
}

/**
 * Parse a bounded ICS document into new local manual events.
 *
 * The parser accepts only UTC `DTSTART`/`DTEND` values (`...Z`) so an import
 * can never silently inherit a browser timezone. `STATUS:CANCELLED` is
 * ignored rather than deleting an existing local entry. The returned events
 * are canonical `normalizeManualPlannerEvent` objects ready for the existing
 * `orbit:planner-manual-event-upsert` bridge.
 */
export function parseManualPlannerEventsIcs(source, options = {}) {
    const limits = {
        maxBytes: Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? Math.min(options.maxBytes, MANUAL_PLANNER_ICS_MAX_BYTES) : MANUAL_PLANNER_ICS_MAX_BYTES,
        maxEvents: Number.isInteger(options.maxEvents) && options.maxEvents > 0 ? Math.min(options.maxEvents, MANUAL_PLANNER_ICS_MAX_EVENTS) : MANUAL_PLANNER_ICS_MAX_EVENTS,
        maxPhysicalLines: Number.isInteger(options.maxPhysicalLines) && options.maxPhysicalLines > 0 ? Math.min(options.maxPhysicalLines, MANUAL_PLANNER_ICS_MAX_PHYSICAL_LINES) : MANUAL_PLANNER_ICS_MAX_PHYSICAL_LINES,
        maxLineLength: Number.isInteger(options.maxLineLength) && options.maxLineLength > 0 ? Math.min(options.maxLineLength, MANUAL_PLANNER_ICS_MAX_LINE_LENGTH) : MANUAL_PLANNER_ICS_MAX_LINE_LENGTH
    };
    const folded = foldIcsSource(source, limits);
    if (folded.fatal) return { ok: false, events: [], errors: folded.errors, rejected: 0 };

    const errors = [...folded.errors];
    const events = [];
    const seenIds = new Set();
    let rejected = 0;
    let calendarOpen = false;
    let calendarClosed = false;
    let currentEvent = null;
    let nestedDepth = 0;
    let seenEventCount = 0;

    const finishCurrentEvent = () => {
        if (!currentEvent) return;
        const result = normalizeImportedManualEvent(currentEvent);
        if (!result.event || seenIds.has(result.event.id)) {
            rejected += 1;
            errors.push(...(result.errors.length ? result.errors : [`El evento ${currentEvent.index} duplica un identificador ICS.`]));
        } else {
            seenIds.add(result.event.id);
            events.push(result.event);
        }
        currentEvent = null;
        nestedDepth = 0;
    };

    for (const line of folded.lines) {
        const property = parseIcsProperty(line);
        if (!property) {
            errors.push("El calendario ICS contiene una propiedad inválida.");
            continue;
        }
        const component = text(property.value).toUpperCase();
        if (property.name === "BEGIN") {
            if (component === "VCALENDAR") {
                if (calendarOpen || calendarClosed || currentEvent) errors.push("La estructura VCALENDAR no es válida.");
                else calendarOpen = true;
            } else if (component === "VEVENT") {
                if (!calendarOpen || calendarClosed || currentEvent) {
                    errors.push("La estructura VEVENT no es válida.");
                } else if (seenEventCount >= limits.maxEvents) {
                    return { ok: false, events: [], errors: [...errors, "El calendario ICS supera el número máximo de eventos."], rejected };
                } else {
                    seenEventCount += 1;
                    currentEvent = { index: seenEventCount, properties: {}, errors: [] };
                }
            } else if (currentEvent) {
                nestedDepth += 1;
            }
            continue;
        }
        if (property.name === "END") {
            if (component === "VCALENDAR") {
                if (!calendarOpen || currentEvent) errors.push("El calendario ICS termina antes de cerrar un evento.");
                calendarClosed = true;
                calendarOpen = false;
            } else if (component === "VEVENT") {
                if (!currentEvent || nestedDepth) errors.push("El cierre VEVENT no coincide con un evento abierto.");
                else finishCurrentEvent();
            } else if (currentEvent && nestedDepth) {
                nestedDepth -= 1;
            }
            continue;
        }
        if (currentEvent && nestedDepth === 0) collectEventProperties(currentEvent, property);
    }

    if (calendarOpen || currentEvent || !calendarClosed) errors.push("El calendario ICS no está cerrado correctamente.");
    if (!events.length && !errors.length) errors.push("El calendario ICS no contiene eventos manuales importables.");
    return {
        ok: Boolean(events.length) && !calendarOpen && !currentEvent && calendarClosed,
        events,
        errors,
        rejected
    };
}

/**
 * Capability description for the current planner boundary. A project may
 * remember a linked-provider preference, but no remote calendar operation is
 * enabled merely by that preference: tokens, endpoints and transport remain
 * outside this local module. Callers can pass compact `{ linkageState,
 * syncPreference }` values or the project metadata under `{ project }`.
 */
export function getManualPlannerSyncCapabilities(options = {}) {
    const source = record(options);
    const project = record(source.project);
    const sourceLinkage = source.linkage;
    const projectLinkage = project.linkage;
    const linkageRecord = record(sourceLinkage || projectLinkage);
    const linkage = text(source.linkageState
        ?? (typeof sourceLinkage === "string" ? sourceLinkage : undefined)
        ?? (typeof projectLinkage === "string" ? projectLinkage : undefined)
        ?? linkageRecord.state
        ?? linkageRecord.provider).toLowerCase();
    const linkedProvider = linkage === "google_linked"
        ? "google"
        : linkage === "microsoft_linked"
            ? "microsoft"
            : "";
    const plannerPolicy = record(source.plannerPolicy || project.modulePolicies?.planner || project.modules?.planner);
    const requestedPreference = source.syncPreference ?? plannerPolicy.syncPreference ?? project.syncPreference;
    const preference = record(requestedPreference);
    const preferenceState = text(preference.state || preference.value || requestedPreference).toLowerCase();
    const remoteRequested = typeof requestedPreference === "boolean"
        ? requestedPreference
        : typeof preference.enabled === "boolean"
            ? preference.enabled
            : preferenceState === "sync_enabled" || preferenceState === "enabled" || preferenceState === "linked";
    return Object.freeze({
        status: MANUAL_PLANNER_SYNC_STATUS.LOCAL_ONLY,
        localIcsImport: true,
        localIcsExport: true,
        remoteSync: false,
        linkedProvider: linkedProvider || null,
        remoteRequested,
        reason: linkedProvider && remoteRequested
            ? "La sincronización remota requiere un adaptador autorizado; el proyecto conserva únicamente su preferencia local."
            : "El planificador funciona localmente; ICS es la vía de intercambio disponible."
    });
}

/**
 * Return a transport-free adapter shape. It is intentionally useful now for
 * local import/export, while `pull` and `push` fail explicitly instead of
 * pretending that a linked project has been synchronised.
 */
export function createManualPlannerSyncAdapter(options = {}) {
    const capabilities = getManualPlannerSyncCapabilities(options);
    const unavailable = () => Object.freeze({
        ok: false,
        status: MANUAL_PLANNER_SYNC_STATUS.REMOTE_UNAVAILABLE,
        reason: capabilities.reason
    });
    return Object.freeze({
        id: "orbit-local-ics",
        capabilities,
        exportIcs: (events, exportOptions) => serializeManualPlannerEventsToIcs(events, exportOptions),
        importIcs: (source, importOptions) => parseManualPlannerEventsIcs(source, importOptions),
        pull: unavailable,
        push: unavailable
    });
}

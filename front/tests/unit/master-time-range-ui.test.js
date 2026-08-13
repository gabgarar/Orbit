import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    MASTER_TIME_RANGE_EXPAND_MESSAGE,
    MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT,
    MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT,
    MASTER_TIME_RANGE_DIALOG_READY_KEY,
    MASTER_TIME_RANGE_OUT_OF_RANGE_MESSAGE,
    MASTER_TIME_RANGE_PENDING_REQUESTS_KEY,
    createMasterTimeRangeExpansionRequest,
    formatMasterTimeRangeUtc,
    masterTimeRangeObjectStatus,
    resolveMasterTimeRangeObjectStatus,
    requestMasterTimeRangeExpansion
} from "../../js/features/masterTimeRange/ui.js";

function eventWithDetail(type, detail) {
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail });
    return event;
}

test("MTR expansion requests preserve the explicit Spanish confirmation and UTC ranges", () => {
    const request = createMasterTimeRangeExpansionRequest({
        id: "sp3-week-1",
        objectName: "COD0MGXFIN",
        range: { startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-08T00:00:00Z" },
        masterRange: { startTime: "2026-08-03T00:00:00Z", endTime: "2026-08-04T00:00:00Z" }
    });

    assert.equal(request.id, "sp3-week-1");
    assert.equal(request.message, MASTER_TIME_RANGE_EXPAND_MESSAGE);
    assert.equal(request.expandLabel, "Ampliar");
    assert.equal(request.cancelLabel, "Cancelar");
    assert.equal(request.range.startTime, "2026-08-01T00:00:00.000Z");
    assert.equal(request.masterRange.endTime, "2026-08-04T00:00:00.000Z");
    assert.match(formatMasterTimeRangeUtc(request.range), /UTC/);

    const storeShape = createMasterTimeRangeExpansionRequest({
        range: { startDate: new Date("2026-08-05T00:00:00Z"), endDate: new Date("2026-08-05T01:00:00Z") }
    });
    assert.equal(storeShape.range.startTime, "2026-08-05T00:00:00.000Z");
});

test("MTR expansion uses an event response and fails closed on cancel", async () => {
    const target = new EventTarget();
    let received = null;
    target.addEventListener(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, (event) => {
        received = event.detail;
        target.dispatchEvent(eventWithDetail(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, {
            id: event.detail.id,
            decision: "cancel"
        }));
    });

    const outcome = await requestMasterTimeRangeExpansion({ id: "manual-orbit-1" }, { target });

    assert.equal(received.id, "manual-orbit-1");
    assert.equal(outcome.decision, "cancel");
    assert.equal(outcome.accepted, false);
});

test("MTR expansion accepts only the explicit expand decision", async () => {
    const target = new EventTarget();
    target.addEventListener(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, (event) => {
        target.dispatchEvent(eventWithDetail(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, {
            id: event.detail.id,
            decision: "expand"
        }));
    });

    const outcome = await requestMasterTimeRangeExpansion({ id: "oem-1" }, { target });

    assert.equal(outcome.decision, "expand");
    assert.equal(outcome.accepted, true);
});

test("MTR expansion settles once, so a late contradictory response cannot turn cancel into expand", async () => {
    const target = new EventTarget();
    target.addEventListener(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, (event) => {
        target.dispatchEvent(eventWithDetail(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, {
            id: event.detail.id,
            decision: "cancel"
        }));
        target.dispatchEvent(eventWithDetail(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, {
            id: event.detail.id,
            decision: "expand"
        }));
    });

    const outcome = await requestMasterTimeRangeExpansion({ id: "same-event-edge" }, { target });

    assert.equal(outcome.decision, "cancel");
    assert.equal(outcome.accepted, false, "the first explicit decision wins and remains fail-closed");
});

test("pending MTR requests drain in order once the React dialog becomes ready", async () => {
    const previousWindow = globalThis.window;
    const target = new EventTarget();
    globalThis.window = target;
    try {
        const first = requestMasterTimeRangeExpansion({ id: "queued-first" }, { target });
        const second = requestMasterTimeRangeExpansion({ id: "queued-second" }, { target });
        assert.deepEqual(target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY].map((item) => item.id), ["queued-first", "queued-second"]);

        const seen = [];
        target.addEventListener(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, (event) => {
            seen.push(event.detail.id);
            target.dispatchEvent(eventWithDetail(MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT, {
                id: event.detail.id,
                decision: event.detail.id === "queued-first" ? "expand" : "cancel"
            }));
        });
        target[MASTER_TIME_RANGE_DIALOG_READY_KEY] = true;
        const drained = target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY].splice(0);
        drained.forEach((detail) => target.dispatchEvent(eventWithDetail(MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT, detail)));

        assert.deepEqual(seen, ["queued-first", "queued-second"]);
        assert.equal((await first).accepted, true);
        assert.equal((await second).accepted, false);
        assert.equal(target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY].length, 0);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("MTR expansion requested before React mounts is queued and still fails closed on abort", async () => {
    const previousWindow = globalThis.window;
    const target = new EventTarget();
    globalThis.window = target;
    const controller = new AbortController();
    try {
        const pending = requestMasterTimeRangeExpansion({ id: "bootstrap-sp3" }, {
            target,
            signal: controller.signal
        });
        assert.equal(target[MASTER_TIME_RANGE_DIALOG_READY_KEY], undefined);
        assert.equal(target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY].length, 1);
        controller.abort();
        const outcome = await pending;
        assert.equal(outcome.accepted, false);
        assert.equal(outcome.reason, "aborted");
        assert.equal(target[MASTER_TIME_RANGE_PENDING_REQUESTS_KEY].length, 0);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("out-of-range presentation is explicit and never describes the object as active", () => {
    const outOfRange = masterTimeRangeObjectStatus("out-of-range");
    assert.equal(outOfRange.status, "out_of_range");
    assert.equal(outOfRange.outOfRange, true);
    assert.equal(outOfRange.active, false);
    assert.equal(outOfRange.label, "Inactivo (fuera de rango)");
    assert.equal(outOfRange.message, MASTER_TIME_RANGE_OUT_OF_RANGE_MESSAGE);

    const telemetryStatus = resolveMasterTimeRangeObjectStatus({
        telemetry: { runtime_state: "OUT OF RANGE" }
    });
    assert.equal(telemetryStatus.outOfRange, true);
    assert.equal(telemetryStatus.message, MASTER_TIME_RANGE_OUT_OF_RANGE_MESSAGE);

    const explicitTemporalStatus = resolveMasterTimeRangeObjectStatus({
        temporal_status: "active",
        telemetry: { runtime_state: "OUT OF RANGE" }
    });
    assert.equal(explicitTemporalStatus.outOfRange, false, "temporal_status is the authoritative field");

    assert.deepEqual(masterTimeRangeObjectStatus("active"), {
        status: "active",
        outOfRange: false,
        active: true,
        label: "Activo",
        message: ""
    });
});

test("MTR controls mount an accessible dialog and expose the reusable object status", () => {
    const dialog = readFileSync(
        new URL("../../../react-ui/src/components/MasterTimeRangeDialog.jsx", import.meta.url),
        "utf8"
    );
    const status = readFileSync(
        new URL("../../../react-ui/src/components/MasterTimeRangeOutOfRangeStatus.jsx", import.meta.url),
        "utf8"
    );
    const overlays = readFileSync(
        new URL("../../../react-ui/src/components/overlays/OrbitOverlays.jsx", import.meta.url),
        "utf8"
    );
    const objectDetails = readFileSync(
        new URL("../../../react-ui/src/components/ObjectDetailsPanel.jsx", import.meta.url),
        "utf8"
    );
    const sidebar = readFileSync(new URL("../../js/objectSidebar.js", import.meta.url), "utf8");

    assert.match(dialog, /role="dialog"/);
    assert.match(dialog, /aria-modal="true"/);
    assert.match(dialog, /MASTER_TIME_RANGE_EXPAND_REQUEST_EVENT/);
    assert.match(dialog, /MASTER_TIME_RANGE_EXPAND_RESPONSE_EVENT/);
    assert.match(dialog, /expandButtonRef\.current.*focus/);
    assert.match(dialog, /respond\("cancel"\)/);
    assert.match(dialog, /respondingRequestIdRef/);
    assert.match(dialog, /respondingRequestIdRef\.current === request\.id/);
    assert.match(status, /masterTimeRangeObjectStatus/);
    assert.match(status, /data-master-time-range-status/);
    assert.match(status, /role="status"/);
    assert.match(overlays, /<MasterTimeRangeDialog\s*\/>/);
    assert.match(objectDetails, /<MasterTimeRangeOutOfRangeStatus object=\{detail\}/);
    assert.match(objectDetails, /INACTIVO · FUERA DE RANGO/);
    assert.match(objectDetails, /disabled=\{!objectActiveForCurrentEpoch\}/);
    assert.match(sidebar, /resolveMasterTimeRangeObjectStatus\(getObjectTelemetry\?\.\(id\)\)/);
    assert.match(sidebar, /layer-time-range-status/);
    assert.match(sidebar, /timeRangeStatus\.message/);
});

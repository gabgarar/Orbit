import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    createOutputFrameSelectionTransaction,
    describeOutputFrameSelectionFailure,
    rollbackOutputFrameSelection
} from "../../js/features/propagatedParameters/frameSelection.js";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/PropagatedOrbitParametersPanel.jsx", import.meta.url),
    "utf8"
);
const appDialogSource = readFileSync(
    new URL("../../../react-ui/src/components/AppDialog.jsx", import.meta.url),
    "utf8"
);

function priorState() {
    return {
        open: true,
        status: "ready",
        requestedOutputFrame: null,
        target: { id: "G01", name: "G01" },
        result: { reference_frame: "IGB20", samples: [{ time: "2026-08-26T00:00:00Z" }] },
        inspector: {
            frame: {
                native: "IGB20",
                current: "IGB20"
            }
        },
        error: "",
        history: [{ id: "propagation:old" }]
    };
}

test("a failed SP3 terrestrial to TEME selection restores the prior usable inspector state", () => {
    const state = priorState();
    const transaction = createOutputFrameSelectionTransaction({
        requestedOutputFrame: "TEME",
        previousRequestedOutputFrame: null,
        previousState: state
    });
    const rollback = rollbackOutputFrameSelection(
        transaction,
        "An external terrestrial frame requires a registered realization transformation before changing frame"
    );

    assert.ok(rollback);
    assert.equal(rollback.requestedOutputFrame, null);
    assert.equal(rollback.state.status, "ready");
    assert.equal(rollback.state.requestedOutputFrame, null);
    assert.equal(rollback.state.error, "");
    assert.equal(rollback.state.result, state.result);
    assert.equal(rollback.state.inspector, state.inspector);
    assert.match(rollback.message, /Se mantiene Nativo \(IGB20\)/);
    assert.match(rollback.message, /realización terrestre/i);
    assert.match(rollback.message, /TEME/);
    assert.match(rollback.message, /ERP\/EOP/i);
    assert.match(rollback.message, /ORBIT_ENABLE_IGS20_FAMILY_ITRF2020_ALIGNMENT=true/);
    assert.match(rollback.message, /Detalle técnico/);
});

test("a previously transformed output frame is restored rather than reset to native", () => {
    const state = priorState();
    state.requestedOutputFrame = "EME2000";
    state.inspector.frame.current = "EME2000";
    const transaction = createOutputFrameSelectionTransaction({
        requestedOutputFrame: "GCRF",
        previousRequestedOutputFrame: "EME2000",
        previousState: state
    });
    const rollback = rollbackOutputFrameSelection(transaction, "EOP coverage is incomplete");

    assert.ok(rollback);
    assert.equal(rollback.requestedOutputFrame, "EME2000");
    assert.equal(rollback.state.requestedOutputFrame, "EME2000");
    assert.equal(rollback.state.inspector.frame.current, "EME2000");
    assert.match(rollback.message, /Se mantiene EME2000/);
});

test("a rollback is unavailable without an earlier verified result", () => {
    const transaction = createOutputFrameSelectionTransaction({
        requestedOutputFrame: "TEME",
        previousRequestedOutputFrame: null,
        previousState: { open: true, status: "propagating", result: null, inspector: null }
    });

    assert.equal(rollbackOutputFrameSelection(transaction, "failure"), null);
});

test("failure text stays actionable even outside the SP3 terrestrial case", () => {
    const message = describeOutputFrameSelectionFailure({
        transaction: createOutputFrameSelectionTransaction({
            requestedOutputFrame: "GCRF",
            previousRequestedOutputFrame: "TEME",
            previousState: {
                ...priorState(),
                inspector: { frame: { native: "TEME", current: "TEME" } }
            }
        }),
        errorMessage: "Leap-second coverage unavailable"
    });

    assert.match(message, /Se mantiene TEME/);
    assert.match(message, /segundos intercalares/i);
    assert.match(message, /Leap-second coverage unavailable/);
});

test("the runtime uses a transaction and an application dialog instead of leaving a frame error inline", () => {
    assert.match(runtimeSource, /createOutputFrameSelectionTransaction/);
    assert.match(runtimeSource, /restorePropagatedParametersOutputFrameSelection/);
    assert.match(runtimeSource, /rollbackOutputFrameSelection/);
    assert.match(runtimeSource, /showAppAlert\(rollback\.message, "No se pudo cambiar el marco de salida"\)/);
    assert.match(runtimeSource, /frameSelectionTransaction/);
    assert.match(runtimeSource, /requestedOutputFrame: propagatedParametersRequestedOutputFrame/);
    assert.match(panelSource, /setPanel\(\(current\) => \(\{[\s\S]*?requestedOutputFrame: requestedOutputFrame \|\| null,[\s\S]*?error: ""/);
    assert.match(appDialogSource, /!z-\[2147483646\]/);
});

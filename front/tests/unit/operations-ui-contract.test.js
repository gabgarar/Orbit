import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("global activity UI is a live operation panel rather than a BIT poll indicator", () => {
    const toolbar = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.jsx", import.meta.url), "utf8");
    const toolbarCss = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.css", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../../../react-ui/src/components/overlays/OperationsPanel.jsx", import.meta.url), "utf8");
    const contract = readFileSync(new URL("../../js/features/operations/operationsContract.js", import.meta.url), "utf8");

    assert.match(toolbar, /topOperationsBtn/);
    assert.match(toolbar, /activeOperationCount > 0/);
    assert.match(toolbar, /ActivityIcon/);
    assert.doesNotMatch(toolbar, /diagnosticsRefreshing|is-refreshing/);
    assert.doesNotMatch(toolbarCss, /orbit-bit-refresh|toolbar-built-in-test-btn\.is-refreshing/);
    assert.match(app, /useOrbitOperations/);
    assert.match(app, /startup-readiness/);
    assert.match(app, /<OperationsPanel/);
    assert.match(panel, /Operaciones en curso/);
    assert.match(panel, /requestOperationCancel/);
    assert.match(panel, /aria-live="polite"/);
    assert.match(contract, /ORBIT_OPERATIONS_CLEAR_SCOPE_EVENT/);
    assert.match(contract, /ORBIT_OPERATIONS_STATE_EVENT/);
    assert.match(contract, /ORBIT_OPERATION_CANCEL_REQUEST_EVENT/);
    assert.match(contract, /Updates never invent a running task/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { objectDetailsSecondaryHeader } from "../../../react-ui/src/features/objectDetails/headerPresentation.js";
import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

const componentSource = readFileSync(
    new URL("../../../react-ui/src/components/ObjectDetailsPanel.jsx", import.meta.url),
    "utf8"
);
const fieldHelpTooltipSource = readFileSync(
    new URL("../../../react-ui/src/components/FieldHelpTooltip.jsx", import.meta.url),
    "utf8"
);

function markupNear(testId, before = 420, after = 820) {
    const marker = `data-testid="${testId}"`;
    const index = componentSource.indexOf(marker);
    assert.notEqual(index, -1, `ObjectDetailsPanel must expose ${marker}`);
    return componentSource.slice(Math.max(0, index - before), index + after);
}

test("SP3 object-details header identifies a GNSS product instead of inventing NORAD", () => {
    const details = buildObjectDetails({
        id: "precise:product:G01",
        sourceFormat: "SP3",
        telemetry: {
            id: "G01",
            source_format: "SP3",
            norad_id: "25544",
            sp3: { satellite_id: "G01", product_id: "product" }
        }
    });
    const secondaryHeader = objectDetailsSecondaryHeader({
        sourceFormat: "SP3",
        noradId: details.noradId
    });

    assert.match(secondaryHeader, /^PRODUCTO GNSS .*SP3$/);
    assert.doesNotMatch(
        secondaryHeader,
        /NORAD/,
        "the SP3 branch in the secondary header must not render NORAD or NORAD -"
    );
});

test("object-details header truncates a long name before it can overlap the close control", () => {
    const panelMarkup = markupNear("object-details-panel", 0, 2600);
    const titleMarkup = markupNear("object-details-title");

    assert.match(panelMarkup, /\bflex\b/, "the header needs a flex layout that can reserve the close-control slot");
    assert.match(titleMarkup, /\bmin-w-0\b/);
    assert.match(titleMarkup, /\btruncate\b|text-ellipsis/);
    assert.match(titleMarkup, /title=\{details\.title\}/, "the complete name remains available on hover");
    assert.match(panelMarkup, /data-testid="object-details-close"/);
    assert.match(panelMarkup, /\bshrink-0\b/, "the close control must retain its hit target when the title is long");
});

test("object-details content uses the shared Orbit custom scrollbar rather than a native panel scrollbar", () => {
    const panelMarkup = markupNear("object-details-panel", 0, 1100);
    const scrollMarkup = markupNear("object-details-scroll-region");

    assert.match(panelMarkup, /\boverflow-hidden\b/);
    assert.doesNotMatch(panelMarkup, /\boverflow-auto\b/, "the drawer shell must not become the native scroll owner");
    assert.match(scrollMarkup, /\borbit-scrollbar\b/);
    assert.match(scrollMarkup, /\boverflow-y-auto\b/);
    assert.match(scrollMarkup, /\bmin-h-0\b/);
    assert.match(scrollMarkup, /\bflex-1\b/);
    assert.match(scrollMarkup, /tabIndex=\{0\}/, "keyboard users must be able to focus the scroll viewport");
});

test("object-details help relies on the field hover target instead of visual info icons", () => {
    assert.match(componentSource, /<FieldHelpTooltip className=\{classes\}/);
    assert.doesNotMatch(
        componentSource,
        /\{help && <svg/,
        "detail labels must not render a separate visual information icon"
    );
    assert.match(fieldHelpTooltipSource, /onPointerEnter=\{showTooltip\}/);
    assert.match(fieldHelpTooltipSource, /onFocus=\{showTooltip\}/);
    assert.match(fieldHelpTooltipSource, /tabIndex=\{0\}/);
    assert.doesNotMatch(
        fieldHelpTooltipSource,
        />i<\/span>/,
        "the help popup itself must not add a decorative information glyph"
    );
});

test("the selected SP3 inspector alone polls the shared EOP diagnostic contract", () => {
    assert.match(componentSource, /import useSystemDiagnostics from "\.\.\/hooks\/useSystemDiagnostics\.js"/);
    assert.match(componentSource, /selectedSourceFormat === "SP3"/);
    assert.match(componentSource, /const selectedSp3PanelShown = Boolean/);
    assert.match(componentSource, /useSystemDiagnostics\(\{\s*enabled: selectedSp3PanelShown\s*\}\)/);
    assert.match(componentSource, /findDiagnosticComponent\(diagnostics, "erp"\)/);
    assert.match(componentSource, /diagnosticsAvailability,/);
    assert.match(componentSource, /eopDiagnostic/);
});

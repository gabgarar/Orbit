import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
    new URL("../../../react-ui/src/components/GroundStationsPanel.jsx", import.meta.url),
    "utf8"
);

test("the AOS/LOS table owns pass selection and opens the elevation profile for that row", () => {
    assert.match(source, /const \[selectedPassIndex, setSelectedPassIndex\] = useState\(null\);/);
    assert.match(source, /data-testid="ground-station-pass-row"/);
    assert.match(source, /onSelectPass=\{setSelectedPassIndex\}/);
    assert.match(source, /selectedPass \? <PassElevationChart result=\{result\} timeZone=\{stationTimeZone\} selectedPassIndex=\{selectedPassIndex\}/);
    assert.match(source, /Selecciona una fila de la tabla para abrir el perfil de elevación/);
    assert.match(source, /aria-selected=\{selected\}/);
    assert.match(source, /event\.key !== "Enter" && event\.key !== " "/);
    assert.doesNotMatch(source, /const \[selectedPass, setSelectedPass\] = useState\(0\)/);
});

test("the pass table keeps active-station context while grouping secondary engineering detail", () => {
    assert.match(source, /Estación activa/);
    assert.match(source, /Configuración RF/);
    assert.match(source, /Datos técnicos del análisis/);
    assert.match(source, /ground-station-pass-analysis/);
    assert.match(source, /ground-station-pass-profile-prompt/);
    assert.match(source, /ground-station-eop-coverage-notice/);
});

// Keep the Cesium runtime as a separately loaded Vite chunk. This makes the
// build validate and transform its complete module graph before the browser
// executes it.
import "../../../front/main.js";

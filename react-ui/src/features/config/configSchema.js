export const sections = {
    orbit: ["propagation_hours", "future_show", "ground_track_show", "future_line_width", "future_color", "selected_color"],
    satellites: ["label_size_px", "model_scale", "use_3d_model", "size_mode", "decay_alert_perigee_km"],
    realtime: ["state_interval_seconds", "orbit_interval_seconds"], logging: ["enabled", "level"],
    rendering: ["antialias_mode", "background_color", "sky_atmosphere", "globe_lighting", "stars_enabled", "earth_basemap"], recording: ["quality", "output_format"], ui: ["language", "theme"]
};
export const tabs = [["orbital", "Orbital", ["orbit", "realtime"]], ["objects", "Objetos", ["satellites"]], ["scene", "Escena", ["rendering", "recording"]], ["system", "Sistema", ["logging", "ui"]]];
export const titles = { orbit: "Órbitas", satellites: "Satélites", realtime: "Tiempo real", logging: "Logs", rendering: "Render", recording: "Grabación", ui: "Interfaz" };
const generatedLabels = Object.fromEntries(
    Object.values(sections)
        .flat()
        .map((key) => [key, key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())])
);
export const labels = {
    ...generatedLabels
};
export const selectOptions = { size_mode: ["visual", "physical"], level: ["debug", "info", "warn", "error", "silent"], antialias_mode: ["off", "fxaa", "msaa"], earth_basemap: ["natural-earth", "earth2km-local", "openstreetmap", "esri-world-imagery"], quality: ["low", "medium", "high"], output_format: ["webm", "mp4"], language: ["es", "en"], theme: ["dark", "light"] };
export const selectOptionLabels = { earth_basemap: { "natural-earth": "Natural Earth (local)", "earth2km-local": "Earth 2 km (local)", openstreetmap: "OpenStreetMap", "esri-world-imagery": "World Imagery (Esri)" } };
export const checkboxes = new Set(["future_show", "ground_track_show", "use_3d_model", "enabled", "sky_atmosphere", "globe_lighting", "stars_enabled"]);
export const colors = new Set(["future_color", "selected_color", "background_color"]);

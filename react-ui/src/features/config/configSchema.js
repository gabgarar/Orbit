export const sections = {
    orbit: ["propagation_hours", "width_mode", "future_show", "ground_track_show", "future_line_width", "future_color", "selected_color", "past_show", "past_seconds", "past_line_width", "past_color"],
    satellites: ["label_size_px", "model_scale", "use_3d_model", "size_mode", "max_visible", "decay_alert_perigee_km"],
    realtime: ["state_interval_seconds", "orbit_interval_seconds"], logging: ["enabled", "level", "show_top_clock"],
    rendering: ["antialias_mode", "background_color", "sky_atmosphere", "globe_lighting", "stars_enabled"], recording: ["quality", "output_format"], ui: ["language", "theme"]
};
export const tabs = [["orbital", "Orbital", ["orbit", "realtime"]], ["objects", "Objetos", ["satellites"]], ["scene", "Escena", ["rendering", "recording"]], ["system", "Sistema", ["logging", "ui"]]];
export const titles = { orbit: "Órbitas", satellites: "Satélites", realtime: "Tiempo real", logging: "Logs", rendering: "Render", recording: "Grabación", ui: "Interfaz" };
export const labels = Object.fromEntries(Object.values(sections).flat().map((key) => [key, key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())]));
export const selectOptions = { width_mode: ["visual", "physical"], size_mode: ["visual", "physical"], level: ["debug", "info", "warn", "error", "silent"], antialias_mode: ["off", "fxaa", "msaa"], quality: ["low", "medium", "high"], output_format: ["webm", "mp4"], language: ["es", "en"], theme: ["dark", "light"] };
export const checkboxes = new Set(["future_show", "ground_track_show", "past_show", "use_3d_model", "enabled", "show_top_clock", "sky_atmosphere", "globe_lighting", "stars_enabled"]);
export const colors = new Set(["future_color", "selected_color", "past_color", "background_color"]);

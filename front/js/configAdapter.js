export function normalizeSystemConfig(rawSystem = {}) {
    const orbit = rawSystem.orbit || {};
    const satellites = rawSystem.satellites || {};
    const realtime = rawSystem.realtime || {};
    const rendering = rawSystem.rendering || {};
    const logging = rawSystem.logging || {};
    const recording = rawSystem.recording || {};
    const ui = rawSystem.ui || {};

    return {
        propagation_hours: orbit.propagation_hours ?? rawSystem.propagation_hours,
        orbit_future_show: orbit.future_show ?? rawSystem.orbit_future_show,
        orbit_ground_track_show: orbit.ground_track_show ?? rawSystem.orbit_ground_track_show,
        orbit_future_line_width: orbit.future_line_width ?? rawSystem.orbit_future_line_width,
        orbit_future_color: orbit.future_color ?? rawSystem.orbit_future_color,
        orbit_selected_color: orbit.selected_color ?? rawSystem.orbit_selected_color,

        satellite_label_size_px: satellites.label_size_px ?? rawSystem.satellite_label_size_px,
        satellite_model_scale: satellites.model_scale ?? rawSystem.satellite_model_scale,
        satellite_use_3d_model: satellites.use_3d_model ?? rawSystem.satellite_use_3d_model,
        satellite_size_mode: satellites.size_mode ?? rawSystem.satellite_size_mode,
        decay_alert_perigee_km: satellites.decay_alert_perigee_km ?? rawSystem.decay_alert_perigee_km,

        websocket_state_interval_seconds: realtime.state_interval_seconds ?? rawSystem.websocket_state_interval_seconds,
        websocket_orbit_interval_seconds: realtime.orbit_interval_seconds ?? rawSystem.websocket_orbit_interval_seconds,

        antialias_mode: rendering.antialias_mode ?? rawSystem.antialias_mode,
        antialias_enabled: rendering.antialias_enabled ?? rawSystem.antialias_enabled,
        background_color: rendering.background_color ?? rawSystem.background_color,
        sky_atmosphere: rendering.sky_atmosphere ?? rawSystem.sky_atmosphere,
        globe_lighting: rendering.globe_lighting ?? rawSystem.globe_lighting,
        stars_enabled: rendering.stars_enabled ?? rawSystem.stars_enabled,
        earth_basemap: rendering.earth_basemap ?? rawSystem.earth_basemap,

        recording_quality: recording.quality ?? rawSystem.recording_quality,
        recording_output_format: recording.output_format ?? rawSystem.recording_output_format,

        log_enabled: logging.enabled ?? rawSystem.log_enabled,
        log_level: logging.level ?? rawSystem.log_level,

        ui_language: ui.language ?? rawSystem.ui_language,
        ui_theme: ui.theme ?? rawSystem.ui_theme
    };
}

export function toSectionedSystemConfig(rawSystem = {}) {
    const flat = normalizeSystemConfig(rawSystem);
    return {
        orbit: {
            propagation_hours: flat.propagation_hours ?? 0.5,
            future_show: flat.orbit_future_show ?? true,
            ground_track_show: flat.orbit_ground_track_show ?? true,
            future_line_width: flat.orbit_future_line_width ?? 2.5,
            future_color: flat.orbit_future_color ?? "#7fd7ff",
            selected_color: flat.orbit_selected_color ?? "#ff2d2d"
        },
        satellites: {
            label_size_px: flat.satellite_label_size_px ?? 10,
            model_scale: flat.satellite_model_scale ?? 1.0,
            use_3d_model: flat.satellite_use_3d_model ?? true,
            size_mode: flat.satellite_size_mode ?? "visual",
            decay_alert_perigee_km: flat.decay_alert_perigee_km ?? 200
        },
        realtime: {
            state_interval_seconds: flat.websocket_state_interval_seconds ?? 1,
            orbit_interval_seconds: flat.websocket_orbit_interval_seconds ?? 1
        },
        logging: {
            enabled: flat.log_enabled ?? true,
            level: flat.log_level ?? "info"
        },
        rendering: {
            antialias_mode: flat.antialias_mode ?? (flat.antialias_enabled ? "fxaa" : "off"),
            antialias_enabled: flat.antialias_enabled ?? true,
            background_color: flat.background_color ?? "#03070d",
            sky_atmosphere: flat.sky_atmosphere ?? false,
            globe_lighting: flat.globe_lighting ?? true,
            stars_enabled: flat.stars_enabled ?? false,
            earth_basemap: flat.earth_basemap ?? "natural-earth"
        },
        recording: {
            quality: flat.recording_quality ?? "medium",
            output_format: flat.recording_output_format ?? "webm"
        },
        ui: {
            language: flat.ui_language === "en" ? "en" : "es",
            theme: flat.ui_theme === "light" ? "light" : "dark"
        }
    };
}

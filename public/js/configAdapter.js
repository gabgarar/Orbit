export function normalizeSystemConfig(rawSystem = {}) {
    const orbit = rawSystem.orbit || {};
    const satellites = rawSystem.satellites || {};
    const realtime = rawSystem.realtime || {};
    const rendering = rawSystem.rendering || {};
    const logging = rawSystem.logging || {};

    return {
        propagation_hours: orbit.propagation_hours ?? rawSystem.propagation_hours,
        orbit_future_show: orbit.future_show ?? rawSystem.orbit_future_show,
        orbit_future_samples: orbit.future_samples ?? rawSystem.orbit_future_samples,
        orbit_future_line_width: orbit.future_line_width ?? rawSystem.orbit_future_line_width,
        orbit_future_color: orbit.future_color ?? rawSystem.orbit_future_color,
        orbit_width_mode: orbit.width_mode ?? rawSystem.orbit_width_mode,
        orbit_past_show: orbit.past_show ?? rawSystem.orbit_past_show,
        orbit_past_color: orbit.past_color ?? rawSystem.orbit_past_color,
        orbit_past_samples: orbit.past_samples ?? rawSystem.orbit_past_samples,
        orbit_past_line_width: orbit.past_line_width ?? rawSystem.orbit_past_line_width,
        orbit_hide_near_satellite: orbit.hide_near_satellite ?? rawSystem.orbit_hide_near_satellite,

        satellite_label_size_px: satellites.label_size_px ?? rawSystem.satellite_label_size_px,
        satellite_model_scale: satellites.model_scale ?? rawSystem.satellite_model_scale,
        satellite_use_3d_model: satellites.use_3d_model ?? rawSystem.satellite_use_3d_model,
        satellite_size_mode: satellites.size_mode ?? rawSystem.satellite_size_mode,
        max_satellites_visible: satellites.max_visible ?? rawSystem.max_satellites_visible,

        websocket_state_interval_seconds: realtime.state_interval_seconds ?? rawSystem.websocket_state_interval_seconds,
        websocket_orbit_interval_seconds: realtime.orbit_interval_seconds ?? rawSystem.websocket_orbit_interval_seconds,
        orbit_cache_ttl_seconds: realtime.orbit_cache_ttl_seconds ?? rawSystem.orbit_cache_ttl_seconds,

        antialias_enabled: rendering.antialias_enabled ?? rawSystem.antialias_enabled,
        background_color: rendering.background_color ?? rawSystem.background_color,
        sky_atmosphere: rendering.sky_atmosphere ?? rawSystem.sky_atmosphere,
        globe_lighting: rendering.globe_lighting ?? rawSystem.globe_lighting,
        stars_enabled: rendering.stars_enabled ?? rawSystem.stars_enabled,

        log_enabled: logging.enabled ?? rawSystem.log_enabled,
        log_level: logging.level ?? rawSystem.log_level
    };
}

export function toSectionedSystemConfig(rawSystem = {}) {
    const flat = normalizeSystemConfig(rawSystem);
    return {
        orbit: {
            propagation_hours: flat.propagation_hours ?? 0.5,
            future_show: flat.orbit_future_show ?? true,
            future_samples: flat.orbit_future_samples ?? 120,
            future_line_width: flat.orbit_future_line_width ?? 2,
            width_mode: flat.orbit_width_mode ?? "visual",
            future_color: flat.orbit_future_color ?? "#7fd7ff",
            past_show: flat.orbit_past_show ?? true,
            past_color: flat.orbit_past_color ?? "#ff9a5a",
            past_samples: flat.orbit_past_samples ?? 120,
            past_line_width: flat.orbit_past_line_width ?? 2,
            hide_near_satellite: flat.orbit_hide_near_satellite ?? true
        },
        satellites: {
            label_size_px: flat.satellite_label_size_px ?? 10,
            model_scale: flat.satellite_model_scale ?? 1.0,
            use_3d_model: flat.satellite_use_3d_model ?? true,
            size_mode: flat.satellite_size_mode ?? "visual",
            max_visible: flat.max_satellites_visible ?? 20
        },
        realtime: {
            state_interval_seconds: flat.websocket_state_interval_seconds ?? 1,
            orbit_interval_seconds: flat.websocket_orbit_interval_seconds ?? 1,
            orbit_cache_ttl_seconds: flat.orbit_cache_ttl_seconds ?? 5
        },
        logging: {
            enabled: flat.log_enabled ?? true,
            level: flat.log_level ?? "info"
        },
        rendering: {
            antialias_enabled: flat.antialias_enabled ?? true,
            background_color: flat.background_color ?? "#03070d",
            sky_atmosphere: flat.sky_atmosphere ?? false,
            globe_lighting: flat.globe_lighting ?? true,
            stars_enabled: flat.stars_enabled ?? false
        }
    };
}

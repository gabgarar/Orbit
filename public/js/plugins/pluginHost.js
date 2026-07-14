/**
 * Minimal lifecycle host for Orbit feature plugins.
 *
 * Plugins are local ES modules registered by the application. Remote code is
 * intentionally not loaded at runtime: browser plugins must ship with the
 * application and be reviewed like any other source file.
 */

export class PluginHost {
    constructor({ logger = console } = {}) {
        this.logger = logger;
        this.plugins = new Map();
        this.activePlugins = [];
    }

    register(plugin) {
        if (!plugin?.id || typeof plugin.id !== "string") {
            throw new TypeError("A plugin must provide a string id.");
        }
        if (typeof plugin.activate !== "function") {
            throw new TypeError(`Plugin ${plugin.id} must provide an activate function.`);
        }
        if (this.plugins.has(plugin.id)) {
            throw new Error(`Plugin ${plugin.id} is already registered.`);
        }

        this.plugins.set(plugin.id, plugin);
        return plugin;
    }

    async start(context = {}) {
        for (const plugin of this.plugins.values()) {
            await plugin.activate(context);
            this.activePlugins.push(plugin);
            this.logger.info?.(`Plugin started: ${plugin.id}`);
        }
    }

    async stop() {
        for (const plugin of [...this.activePlugins].reverse()) {
            await plugin.deactivate?.();
            this.logger.info?.(`Plugin stopped: ${plugin.id}`);
        }
        this.activePlugins = [];
    }
}

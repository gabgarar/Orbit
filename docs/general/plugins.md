# Orbit Plugin Roadmap

## Current state

Orbit has no `PluginHost`, plugin registry, extension manifest, or plugin
lifecycle in the running application. Code is integrated as normal source
modules and is reviewed, built, and tested with the product.

No public or internal plugin API should be inferred from the modular layout of
the repository.

## Preconditions for a future system

Before any plugin boundary is introduced, Orbit must define:

1. Startup, activation, deactivation, and failure semantics owned by a runtime
   host.
2. A minimal, explicit, versioned context rather than access to `main.js` or
   arbitrary DOM state.
3. Extension identity, manifests, compatibility, upgrades, and project-data
   migration.
4. Security and distribution policy. Browser startup must not execute arbitrary
   downloaded code.
5. Ownership, cleanup, observability, and test requirements for each extension.

## Current contribution model

Extract a domain into an ordinary module with clear ownership and tests. Keep
the module connected through the existing application composition layer. This
is an internal refactoring practice, not an extension mechanism.

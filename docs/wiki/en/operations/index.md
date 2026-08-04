# Operation

[Home](../index.md) · [Installation](../getting-started/installation.md) · [User Guide](../user-guide/index.md)

This section covers local runtime operation, persistent configuration,
temporal data for terrestrial transformations and adjustments that affect
at the cost of viewing. Does not describe a management platform
multi-user or a managed service.

## Operational pages

| Page | Scope |
| --- | --- |
| [Settings](configuration.md) | Persistent file, configuration panel, catalog and execution variables. |
| [Time and EOP](time-eop.md) | Local snapshots C04, leap seconds, UT1, ITRF and strict mode. |
| [Performance](performance.md) | Presentation and frequency settings that change the cost of runtime. |
| [Validation](validation.md) | Healthcheck, automated suites and operation data validation. |
| [FAQ](faq.md) | Responses to verified operational limits and behaviors. |

## Operating limits

- Orbit runs as a local Node.js gateway with a private Python backend.
  The gateway is the HTTP endpoint exposed by Compose.
- The config/ folder is persistent in the standard Docker deployment. Protect
  your copies and apply version control or backups outside of runtime.
- There is no authentication, authorization, secret management, multi-tenancy or
  product audit log.
- No EOP data is downloaded during a transformation. The update of
  Precision is done using local files and explicit restart.

To build or restart the service, follow [Installation](../getting-started/installation.md).
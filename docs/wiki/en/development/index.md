# Development

This section describes the structure found in the repository and the
necessary practices to modify it without mixing responsibilities of
interface, gateway, orbital calculation and persistent data.

| Page | Content |
| --- | --- |
| [Architecture](architecture.md) | Processes, modules, limits of responsibility and data flow. |
| [Testing](testing.md) | Test layers, commands and artifacts. |
| [Validation](validation.md) | Input validation, numerical contracts and strict configuration. |
| [Contribute](contributing.md) | Maintenance rules and verification of changes. |
| [Deployment](deployment.md) | Docker image, Compose, persistence and local operation. |

## Maintenance principle

A change must explicitly preserve the frame of reference, the scale
time, units and provenance when reaching orbital data. The
interface should not invent those attributes, and numeric modules should not
acquire remote data during a transformation.

## Related interfaces

- [REST API](../integrations/rest-api.md)
- [WebSocket](../integrations/websocket.md)
- [Glossary](../reference/glossary.md)
- [Bibliography](../reference/bibliography.md)
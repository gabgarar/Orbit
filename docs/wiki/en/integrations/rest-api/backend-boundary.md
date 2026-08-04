# REST API: backend frontier

[Integrations](../index.md) · [REST API](../rest-api.md) · [Architecture](../../development/architecture.md)

FastAPI also implements `/catalog`, `/health`, `/reload` and exports
internal. Except for the destinations published by the gateway, they are not part of the
integration contract.

Do not configure external clients against the Python port or depend on it.
remains accessible outside the container. See [Architecture](../../development/architecture.md)
to distinguish the three layers of execution.
# API reference

## Overview

Public integration uses gateway HTTP. WebSocket supplies best-effort workspace snapshots.

## Contracts

Requests are validated before propagators or adapters. Canonical and legacy `camelCase` fields are documented together where compatibility needs both. Responses retain native frame, transform path, EOP quality and pinned-data identity.

## HTTP areas

| Area | Responsibility |
| --- | --- |
| System and catalogue | Health, settings, records and import. |
| Orbit operations | Propagation, native state, ephemerides and parameters. |
| Ground stations | Station geometry and frame-aware operations. |
| Export | Format-aware results and responses. |
| Backend boundary | Declared Node→Python contract. |

```json
{"epoch":"2026-07-25T12:00:00Z", "targetFrame":"ITRF2020", "strict":true}
```

OpenAPI defines the exact endpoint and schema; the example only shows intent.

## Limits

- Input errors are explicit, not silent fallbacks.
- WebSocket does not guarantee delivery or retention of each snapshot.
- Python port is private and not part of supported API.

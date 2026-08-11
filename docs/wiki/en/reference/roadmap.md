# Roadmap

## Planning status

There is no approved public roadmap, list of milestones with dates or a
verifiable product prioritization in the repository. Therefore, Orbit does not
publishes delivery commitments, estimated dates or guarantees that a
absent capacity is going to be incorporated.

This page separates the available scope of verifiable absences for
prevent extensible architecture from being interpreted as a promise.

## Capabilities with verifiable implementation

| Area | Current status | Reference |
| --- | --- | --- |
| Local HTTP/WebSocket gateway | Implemented. | [Integrations](../integrations/index.md) |
| TLE SGP4 Propagation | Implemented with native TEME state. | [Glossary](glossary.md) |
| Manual orbits | Two-body and Cowell/RK4 with limited forces, in EME2000. | [REST API](../integrations/rest-api.md) |
| Explicit time and frames | EOP modules, leap seconds, `StateVector` and transformations. | [Architecture](../development/architecture.md) |
| Precise GNSS products | Durable local required-SP3 import with associated CLK/ERP/SUM/ATT/OSB and IGS/CDDIS, MGEX, or ESA NSO provenance. | [Precise GNSS products](../formats/precise-products.md) |
| local Docker Compose | Implemented. | [Deployment](../development/deployment.md) |

## Capacities not available

| Capacity | Verifiable status | It should not be inferred |
| --- | --- | --- |
| Distributed Python SDK | There is no package or public contract. | Make `orbit_api` a supported SDK. |
| Product CLI | There is no executable or command specification. | Make Windows scripts a stable CLI. |
| Plugin architecture | There is no plugin host, registry, or plugin API in the runtime. | That internal modules are extensions or that an operational `PluginHost` exists. |
| Authentication and authorization | Not implemented. | That an exposed API is secure by default. |
| Collaboration/multitenancy | Not implemented. | That projects are synchronized between users. |
| Orbit determination | Not implemented. | Let osculating elements be an OD solution. |
| Synthetic-TLE fitting or export | Not implemented. | That a manual EME2000 state converts directly into a TLE/TEME. |
| Precision OEM operational load | Not exposed by UI, gateway, or public API. | Treating a Python reader as a product route. SP3 and its GNSS ancillary products have their own documented local route. |
| CI, artifacts and automated releases | Not declared. | Let local commands publish a release. |
| Managed Kubernetes/Helm/cloud | Not included. | Let Docker Compose describe a multi-instance deployment. |

## Criteria for publishing a future initiative

A capability should only appear as a roadmap initiative if there is a
traceable product decision. Before announcing it, it must be specified:

1. Problem and target user.
2. Entry/exit contract, security and persistence.
3. Frames, time scales, units, auxiliary data and precision if necessary
   numerical.
4. Performance, capacity and error limits.
5. Compatibility with existing projects, APIs and configuration.
6. Test plan, documentation and operation.
7. Responsible, target version and acceptance criteria.

Without these elements, an idea, a work note or an internal module does not constitute a commitment.
of roadmap.

## Relationship to release notes

[Release Notes](release-notes.md) describes identifiable changes that are already
They exist in history. This page does not convert product absences into
future commits or extrapolate dates from previous commits.

## Related references

- [Release Notes](release-notes.md)
- [Python SDK](../integrations/python-sdk.md)
- [CLI](../integrations/cli.md)
- [Plugins](../integrations/plugins.md)

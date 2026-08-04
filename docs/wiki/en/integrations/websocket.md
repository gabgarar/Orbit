# WebSocket

## Purpose

The Orbit WebSocket delivers status and orbit updates for
single customer subscriptions. The gateway maintains its connection
origin and forwards it to the private Python backend. It is not a control channel
simulation, collaboration, project persistence or telemetry of a
real vehicle.

```text
ws://127.0.0.1:8100/ws
```

When the application is served over HTTPS, the client must use `wss://`.
The exact path is `/ws`; other upgrade paths are rejected in the
gateway.

## Opening and security limit

No authentication header or token is required. The endpoint must be maintained
on a trusted network or protect yourself with external infrastructure. The gateway
imposes a maximum of 10 seconds to complete the handshake to the backend;
If this is not available you can close with `502` or `504`.

When accepting a connection, the server immediately sends the catalog of
names:

```json
{
  "type": "catalog",
  "data": ["ISS (ZARYA)", "…"],
  "compressed": false
}
```

The connection starts without subscriptions. Therefore, the first updates
`state` and `orbits` may contain empty arrays until a
valid order.

## Customer messages

The server accepts JSON text or UTF-8 bytes. Invalid messages,
Unknown types and identifiers other than strings are ignored without
an error response.

| `type` | `ids` field | Effect |
| --- | --- | --- |
| `subscribe` | Satellite name list | Add names to the current subscription. |
| `unsubscribe` | Satellite name list | Removes names from the current subscription. |
| `set_subscriptions` | Satellite name list | Replaces the entire subscription. |

Example:

```json
{
  "type": "set_subscriptions",
  "ids": ["ISS (ZARYA)"]
}
```

Names that do not exist in the current snapshot are preserved in the selection
of the client, but they do not generate state or orbit until they appear in the
catalogue. Each valid command forces an update in the next cycle of the
server.

## Server messages

| `type` | Default frequency | Content |
| --- | --- | --- |
| `catalog` | Once when connecting. | List of available names. |
| `state` | 1 s, configurable in `system.realtime.state_interval_seconds`. | A subscribed satellite state that is still available. |
| `orbits` | 10 s, configurable in `system.realtime.orbit_interval_seconds`; only if future orbit is enabled. | Sample paths for available subscriptions. |

`state` example:

```json
{
  "type": "state",
  "data": [
    {
      "satellite": "ISS (ZARYA)",
      "reference_frame": "ITRF",
      "position_units": "m",
      "velocity_units": "m/s",
      "position": { "x": 1.0, "y": 2.0, "z": 3.0 },
      "velocity": { "x": 4.0, "y": 5.0, "z": 6.0 }
    }
  ],
  "compressed": false
}
```

The numerical values in the example are illustrative. The ITRF framework and
Indicated units are part of the status update contract.
For the meaning of TEME, ITRF and the quality of guidance data
Earth, see [Glossary](../reference/glossary.md).

## Encoding and compression

The server serializes the payload as JSON. If the text reaches the threshold
compression configured (1024 characters by default), compresses
with `zlib` level 6 and sends a binary frame **only when the result is
smaller**. Otherwise, send a text frame.

!!! warning "Compression is not self-documented by the `compressed` field"

    The implementation preserves `"compressed": false` within the payload
    even when the transport chooses a compressed binary frame. The
    Robust clients must decide on frame type: parse JSON for
    text and apply `zlib` before parsing JSON to binary. They should not use
    that field as a transportation signal.

## Lifecycle management

The session maintains connection-isolated subscription state. When disconnecting
the client, the receiver is canceled and the backend releases the session. The gateway
closes pending sockets and handshakes during its stop.

No subscription confirmations, retry, global order, ID
session, delivery guarantee or resumption from a stream. The consumer
you must treat each `state` or `orbits` message as a replaceable snapshot.

## Operating limits

- The protocol does not expose authentication, roles or access filters.
- Subscriptions are identified by catalog names, not a subscription ID.
  versioned session.
- The precision of the states depends on the propagator and the temporal data
  and EOP configured; the channel does not add numerical fidelity.
- The connection does not implement a project API, interface events or
  historical reproduction.

## Related references

- [REST API](rest-api.md)
- [OpenAPI](openapi.md)
- [Architecture](../development/architecture.md)
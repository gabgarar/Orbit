# CLI

## Status

Orbit does not provide a product command line interface.

There is no `orbit` executable, no subcommand for propagation, no interface
versioned automation or a specification of arguments and codes
output for external users. Product operations are carried out from
the web application or through the [REST API](rest-api.md).

## Existing commands in the repository

The repository includes PowerShell scripts and `.cmd` files aimed at
local operation on Windows, plus npm scripts for development. They are
repository tools, not a public CLI or SDK.

| Action | Existing interface |
| --- | --- |
| Reboot and check Orbit with Docker | `./.scripts/restart-orbit.cmd` or `.ps1`. |
| View status and healthcheck | `./.scripts/orbit-status.cmd` or `.ps1`. |
| Follow container logs | `./.scripts/orbit-logs.cmd` or `.ps1`. |
| Run Node, frontend, backend or UI tests | `test-*.cmd`/`.ps1` scripts and npm commands described in [Testing](../development/testing.md). |
| Start the gateway during development | `npm run start --prefix server`, after compiling `react-ui`. |
| Generate local tiles from the ground texture | `npm run tiles:earth2km --prefix server`. |

Windows scripts check dependencies like Docker or npm and some
They restart the container before executing their task. They should not join a
external automation pipeline without reviewing its operational effects.

## Explicit limits

- There is no supported command line command to import TLE, propagate
  an orbit, create a project or export an anniversary.
- There is no CLI to install, list or update plugins.
- No authentication or configuration of API credentials via CLI.
- npm commands describe the current development tree and can change
  along with the source code.

## Related references

- [Deployment](../development/deployment.md)
- [Testing](../development/testing.md)
- [REST API](rest-api.md)
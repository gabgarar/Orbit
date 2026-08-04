# Operation FAQ

[Start](../index.md) · [Operation](index.md) · [Installation](../getting-started/installation.md) · [Configuration](configuration.md) · [Validation](validation.md)

## Why does a reboot show so much output?

The command ./.scripts/restart-orbit.cmd rebuilds the image by default.
During the build, dependencies are installed, Node tests are executed,
frontend and Python, and React is compiled. The output corresponds to those phases,
in addition to the recreation of the container and the healthcheck. If the current image already
contains the desired code, use:

~~~powershell
./.scripts/restart-orbit.cmd -SkipBuild
~~~

Do not combine -SkipBuild with -NoCache.

## Where are the configuration and catalog kept?

They are kept in config/ of the repository. Compose mounts that folder as
/app/config, so normal recreating a container does not delete it.
See [Settings](configuration.md) before editing
config/system_config.json manually.

## Why does Orbit only open on my computer?

By default, Compose publishes the gateway at 127.0.0.1. This decision avoids
By default, expose an application without authentication or authorization. For
deliberately expose it, set ORBIT_HTTP_BIND=0.0.0.0 and apply a
firewall or proxy with external access control. The port configuration is
described in [Installation](../getting-started/installation.md).

## Why doesn't the simulation bar appear?

The full bar appears only in Simulated mode. Static and Real time use the
compact date, time and mode selector; Real time can be paused without showing
a simulated range. See [Timeline](../user-guide/timeline.md).

## Why can't I edit the range when there is an OEM?

A local OEM path can activate its temporary domain. The editor of
range is disabled to not ask for positions outside of the OEM samples. At
mix OEM with TLE or OMM, check the range before interpreting the comparison.
See [Import](../user-guide/import.md).

## Why doesn't a pure OEM enter the catalog?

The catalog path requires an embedded TLE, identified by TLE_LINE1 and
TLE_LINE2, to create a propagable object. A pure OEM does not convert from
implicitly in that object. The viewer has a separate path for
tabulated local OEM trajectories, with their own limitations of
persistence.

## Why is a local OEM not restored when opening a project?

The project document preserves a serializable composition, not the
Complete samples from a local OEM track record. File the original OEM together
to the project JSON and reload it. See [Projects](../user-guide/projects.md).

## Can I import SP3, OPM, CPF or RINEX from the interface?

No. There is a SP3 Python reader with native metadata, but there is no
SP3 import path by UI, public gateway, or Orbit runtime. OPM, CPF and
RINEX are not available. See [Import](../user-guide/import.md).

## Is visual mode suitable for precision terrestrial export?

Not by itself. Without local C04, Orbit uses a UTC≈UT1 visual approximation; without
local leap second table uses an included historical schedule.
For reproducible operation, set C04, hashes, leap-seconds.list,
coverage window and explicit realization following
[Time and EOP](time-eop.md).

## Are ITRF and IRTF the same acronym?

No. The correct acronym is ITRF, International Terrestrial Reference Frame.
Furthermore, ITRF represents a family of implementations. Orbit does not relabel
implicitly IGS20, IGb20 or IGc20 as ITRF; the only global alignment
included is IGS20 ↔ ITRF2020 and requires explicit activation.

## Does Orbit include users, collaboration, stable public API, SDK or CLI?

No. The gateway and backend expose runtime interfaces, but there is no
formal public version of API, distributed SDK, product CLI, system
users, access control or collaboration in real time.

## How do I know if the runtime is healthy?

Check docker compose ps or run ./.scripts/orbit-status.cmd. For
check the code and contracts covered, run the suites described in
[Validation](validation.md). A correct healthcheck does not replace the review
of the input data or the EOP configuration.
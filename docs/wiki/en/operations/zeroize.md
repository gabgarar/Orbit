# Full operational reset

[Start](../index.md) · [Operations](index.md) · [Configuration](configuration.md)

Orbit includes a controlled local reset for preparing an installation as if it
were its first run, without deleting source code or dependencies. It is useful
for testing, demonstrations, and starting a local instance from scratch.

## Run it

From the repository root, run:

~~~powershell
.\.scripts\zeroize-orbit.cmd
~~~

The script displays its scope and asks for one PowerShell confirmation before
making changes. To inspect the scope without changing anything:

~~~powershell
.\.scripts\zeroize-orbit.cmd -WhatIf
~~~

By default it leaves Orbit stopped so the next launch shows cold-start
preparation, download, and validation. To restart immediately afterwards:

~~~powershell
.\.scripts\zeroize-orbit.cmd -Restart
~~~

`-IncludeDevelopmentArtifacts` also removes test caches and build artifacts;
it never removes `node_modules` or virtual environments.

## What is reset

The script stops the Compose service when needed and removes:

- IERS C01 and `finals2000A.all` caches under `data/erp/`.
- The NGA EGM96/EGM2008 cache, including archives and extracted coefficients.
- Imported precise GNSS products (SP3, CLK, ERP, ATT, OSB and manifests) and
  manual-orbit ERP snapshots.
- Runtime logs and, optionally, development artifacts.
- Orbit browser preferences, local accounts, non-exportable keys, and encrypted
  projects.

The browser portion does not attempt to erase a whole Chrome/Edge profile. The
script writes a new generation in `data/`; when Orbit next opens, the client
checks it **before** identity initialisation and clears only Orbit-namespaced
storage. The `admin@orbit.com` account is therefore removed too and must be
created again.

If another Orbit tab is holding IndexedDB open, startup shows an actionable
notice and does not mount the old identity. Close all other Orbit tabs and
reload to complete the reset.

## Preserved resources

Two files are restored from the versioned `HEAD` seed instead of being left
empty:

- `config/catalog.json`
- `config/system_config.json`

This keeps the Docker image buildable with a valid catalogue and configuration.
Local changes to those files, including imported TLEs and persisted
preferences, are discarded. Operational products and caches are removed even
if Git reports them as deleted after the reset.

`config/eop/leap-seconds.list` is preserved. It is a SHA-256-pinned IERS
snapshot required for precise transformations and is not downloaded
automatically; deleting it could prevent a safe startup.

External sources set through `ORBIT_*_PATH` variables are never followed or
deleted. The script warns when it finds such a configuration.

## After the reset

Start Orbit normally:

~~~powershell
.\.scripts\restart-orbit.cmd
~~~

The monitor downloads and validates automatic IERS and NGA caches again. SP3
and manual ERP data are intentionally reproducible local imports; they are not
downloaded automatically and need to be imported again when required.

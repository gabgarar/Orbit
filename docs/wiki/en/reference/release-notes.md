# Release Notes

## Scope

This page only registers versions that can be identified in the
Git history of the repository. It does not replace a published release system or
declares a version for changes that remain uncommitted.

The repository has no Git tags or published release artifact in the inspected
state. The following version names come from commit messages and must be
treated as historical source-code milestones, not downloadable packages or
support contracts. The publishing mechanism is nevertheless declared: it runs
only for a valid SemVer tag and does not by itself turn this history into a
published release.

## Identifiable history

| Version indicated | Date | Commit | Evidence in history |
| --- | --- | --- | --- |
| v0.0.24 | 2026-06-27 | `4dd03b1` | `Added v0.0.24` |
| v0.0.25 | 2026-06-27 | `740b2db` | `New version v0.0.25` |
| v0.1.0 | 2026-06-27 | `01bbb5d` | `New version v0.1.0` |
| v0.1.1 | 2026-07-02 | `cd76609` | `release: v0.1.1 — mejoras de UI (paletas clara/oscura, toolbar, footprint, lista de satélites)` |

The historical documentation under `docs/general/VERSIONADO.md` contains notes
additional work, but it does not replace Git tags or a Git policy.
automated publishing.

## Unpublished job status

Uncommitted mods do not receive a version on this page. one
worktree changelist should not be presented as a release: it may contain
incomplete work, local configuration changes or unverified settings.

## Currently testable policy

| Appearance | State |
| --- | --- |
| release Git tags | Not present in the inspected repository. |
| Published release artifacts | Not present in the inspected state. |
| Changelog generated | Not implemented. |
| Formal REST API/WebSocket Versioning | Not published. |
| Quality, documentation, and release CI | Declared in GitHub Actions; `release.yml` publishes only for a valid SemVer tag and verifies checksums. |
| Manual history file | It exists under `docs/general/VERSIONADO.md`. |

## Requirements for a future release note

A reproducible release should include, at a minimum:

1. Immutable Git tag and consistent version across artifacts.
2. Date, commit hash and scope of changes.
3. Compatibility and configuration migrations, catalog, API and projects.
4. Precision changes, models, frameworks, timelines and EOP products.
5. Tests run and known restrictions.
6. Identifiable image or distribution mechanism.
7. `config/` update and rollback instructions.

This list describes minimum traceability information; does not announce that
publishing mechanism is implemented.

## Related references

- [Roadmap](roadmap.md)
- [Contribute](../development/contributing.md)
- [Testing](../development/testing.md)

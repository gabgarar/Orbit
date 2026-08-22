# Local identity and linked projects

[Home](../index.md) · [User Guide](index.md) · [Projects](projects.md) · [Planner](planner.md)

!!! success "Implemented locally"

    Orbit includes an access gate, an encrypted vault per account, and a
    per-user project library on this device. There is no Orbit user backend and
    no automatic remote synchronization. Google and Microsoft integrations are
    enabled only through a local companion configured by the host.

The module keeps identity, local encryption/persistence, and external adapters
separate. This is intentional: creating an account or linking an identity does
not implicitly authorize a project upload, calendar read, or telemetry.

## Access and states

Orbit requires an authenticated session before showing the project hub or
accepting create, open, save, or export commands. Scientific-startup validation
still applies afterwards: a valid session does not bypass a `projectReady:
false` block while Orbit prepares its operational resources.

| Group | States | Current use |
| --- | --- | --- |
| Identity | `unauthenticated`, `local_user`, `google_user`, `microsoft_user` | No session, an unlocked local account, or an external identity linked to its local protector. |
| Project | `no_project_open`, `project_open`, `project_new`, `project_generated` | Hub, existing project, new project, or project generated from scratch. |
| Linkage | `local_only`, `google_linked`, `microsoft_linked` | Local project metadata; it does not start a transfer. |
| Sync preference | `sync_disabled`, `sync_enabled` | A persisted preference for a future explicit adapter, not a network state. |

~~~mermaid
stateDiagram-v2
    [*] --> unauthenticated
    unauthenticated --> local_user: create or unlock local account
    local_user --> google_user: local companion completes OAuth
    local_user --> microsoft_user: local companion completes OAuth
    google_user --> local_user: use local identity
    microsoft_user --> local_user: use local identity
    local_user --> no_project_open
    google_user --> no_project_open
    microsoft_user --> no_project_open
    no_project_open --> project_new: create
    no_project_open --> project_generated: generate from scratch
    no_project_open --> project_open: open or import
    project_new --> project_open: save
    project_generated --> project_open: save
    project_open --> no_project_open: close
~~~

A Google or Microsoft session is a logical identity (`provider:subject`) backed
by the local account that holds the vault. The local account remains the
cryptographic protector and opaque storage scope; email and display name are
not used as storage keys.

### Email-first access

The access screen asks for the email or local identifier first and checks it
**only on this device**. The check compares the vault's opaque selector: it
does not unlock an account, read a profile, or return project data. When an
account is found, the password field is shown; when it is not found,
registration is offered. An indeterminate result (for example, when the local
HMAC key has been lost) does not claim that an account exists or is free, but
does allow a password-based recovery attempt. Unlocking succeeds only when the
password authenticates the encrypted vault.

## Encrypted local vault

The implementation does not store a random root key or wrapped data keys. Each
local account directly uses a 256-bit AES key derived from its password:

1. The password is never stored or recoverable. Web Crypto derives a
   **non-extractable** key using PBKDF2 with SHA-256, a random salt of at least
   16 bytes, and **310,000 iterations by default**. A vault declaring fewer
   than **100,000 iterations** is rejected.
2. That key is used with AES-256-GCM. Every encryption gets a fresh 12-byte
   IV. Authenticated data binds schema, version, and ownership: account plus
   selector for an account vault, or account plus purpose for sealed data. An
   authentication or format failure blocks the read; its content is never
   treated as valid JSON.
3. The sole unencrypted index is stored under one guarded local-storage key.
   It contains opaque account IDs. New accounts use an HMAC-SHA-256 selector
   of the normalized identifier, computed with a random, non-extractable
   HMAC key unique to the installation and persisted in IndexedDB.
   `localStorage` holds only the opaque key reference, never its material or a
   reusable deterministic hash of an email or name. The identifier, profile,
   external identities, and token envelopes remain inside ciphertext.
4. V1 indexes with a SHA-256 selector are accepted only for compatibility: a
   successful account unlock migrates them to v2 and reseals the vault with an
   HMAC selector. If the IndexedDB selector key is lost, an existing account
   can be recovered by password-verifying candidates and its reference is
   rotated when the store is available; creating another account fails closed
   until that store is available. It never falls back to a new SHA-256
   selector.
5. Sessions are not persisted. A new service instance starts as
   `unauthenticated`; the unlocked key and `seal`/`open` capabilities exist
   only in memory. Signing out or changing session invalidates those
   capabilities.
6. Provider tokens are stored only as AES-GCM encrypted vault envelopes.
   Public APIs return status and encrypted metadata; the only plaintext
   consumption point is a short-lived `withProviderTokens` callback while the
   session remains active.

!!! warning "Browser boundary"

    Password encryption protects persistent data against a passive copy of
    storage without the password. It does not turn `localStorage` into an
    operating-system secret manager. The non-extractable HMAC key prevents an
    isolated `localStorage` copy from reproducing the selector, but does not
    protect against malicious same-origin code that can invoke it, or an
    already compromised live session. That level of protection needs a desktop
    container and OS credential store.

The identity core and local project library make no `fetch` calls, contain no
telemetry, and do not depend on an Orbit server.

## Per-user project library

After authentication, Orbit opens a library associated with the session's
logical owner. An external identity can be the visible owner, but its envelope
is sealed by the backing local-vault capability. As a result, inspecting
`localStorage` does not reveal project names, manual planner events, or scene
data.

The following are encrypted independently:

- the library index (metadata, names, linkage, and preferences);
- each project document, bound to its `projectId`, revision, and encryption
  purpose.

Metadata includes a random local `projectId`, owner, timestamps, version,
creation mode, linkage, and sync preference. The library supports create,
import, open, save, rename, duplicate, delete, and export. Operations are
serialized and validate format and revision before accepting a document. When
the browser offers Web Locks, writes are coordinated across tabs as well;
without Web Locks only process-local serialization exists, so old browsers are
not promised a cross-tab transaction. Storage keys derive an opaque partition
from the vault scope and logical owner without including raw owner IDs.

The document retains authored project data: layers, configuration, scene, and
manual planner events/filters. AOS/LOS passes, BIT notices, ERP horizons, and
other derived outputs are recalculated locally; they are not persisted as
user-authored events.

Project export is explicit and produces a readable `.orbit.json` document; it
is not encrypted by default. Treat it like any shareable file. The planner
keeps manual events in that document and can export them locally as ICS when
that function is requested; an ICS export does not enable an external account.

## Linkage and synchronization

`google_linked` and `microsoft_linked` are linkage metadata. They may retain a
future remote-project reference, but the current library does not call Drive,
OneDrive, Google Calendar, or Microsoft Graph.

The Planner `sync_enabled` setting is a **local preference** for a future,
explicit synchronization adapter. At present:

| Resource | Implemented behavior |
| --- | --- |
| Project document | Per-user local encryption; explicit import and export. |
| Manual planner events | Saved in the project; local ICS export. |
| Passes, AOS/LOS, ERP, SP3, BIT, and derived events | Computed in Orbit; neither synchronized nor saved as a manual calendar. |
| Account and tokens | Local encrypted envelopes; never part of an exported project file. |
| Sync control | Records only preference and linked-project eligibility; starts no requests. |

When an adapter is added, it must request concrete scopes and a destination,
show what leaves the device, record conflicts, and allow the linkage to be
revoked. None of those transfers is implemented by the current toggle.

## Google and Microsoft with OAuth PKCE

External options are shown only when online, when PKCE configuration is valid,
and when a trusted local OAuth companion can complete the flow. When they are
not ready, they do not consume space on the access screen. `enabled: true`
alone, a configuration object, or an event listener is not enough: the
companion must provide both `enabled: true` and a callable `start` function.
Offline, only a local account can be created or unlocked. An existing external
session also cannot be re-entered without network access or after its token
expires.

An external flow first creates or unlocks a **local vault protector**. The
companion—not the React component—owns PKCE, the system browser, callback,
code exchange, and identity validation. The UI invokes
`start({ provider, capability, transactionId, signal, service })` directly
in-process; `service` is never published to the DOM and is scoped to that
provider and transaction. The trusted companion stores the encrypted token
envelope through that local capability and then completes the external identity.
When `start` resolves, Orbit verifies that the session actually became
`google_user` or `microsoft_user` for the requested provider. Otherwise the
link fails closed and the external workspace does not open.

A host bootstrap can declare the minimum contract as follows:

```js
window.__orbitOAuthCompanion = {
  enabled: true,
  providers: ["google", "microsoft"],
  async start({ provider, capability, transactionId, signal, service }) {
    // Trusted host code: PKCE, browser/callback, and verified identity.
    // Respect signal.aborted; never send credentials or tokens through the DOM.
    await service.storeProviderTokens(provider, tokenPayload);
    await service.completeExternalIdentity({
      provider,
      identity: verifiedIdentity,
      tokenEnvelope: service.getProviderTokenEnvelope(provider)
    });
  }
};
```

`transactionId` is an opaque correlator, not an OAuth secret. When the user
chooses **Continue with local account only**, signs out, or the UI unmounts,
Orbit aborts `signal` and invalidates that transaction before accepting a
result. The companion must close or ignore its callback when `signal.aborted`
is `true`. Even if a late return tries to complete the flow, the scoped
capability rejects it and Orbit returns to the local protector; that result is
not published as an external session. The workspace is gated from the start of
the operation, including asynchronous local-vault creation or unlocking.

If cancellation arrives after an envelope was written, cleanup does not perform
a separate read and delete: it re-reads and authenticates the encrypted vault
inside the same mutation lock and removes it only when the current envelope is
exactly the one created by that transaction. A newer envelope from another tab
or instance therefore wins the race and is preserved.

The module provides utilities to prepare and validate Authorization Code +
PKCE with S256, but those utilities do not contact a provider, exchange codes,
renew tokens, or accept a `client_secret`.

As an optional observability signal, the UI may emit the local
`orbit:identity-oauth-request` event with this contract:

```json
{
  "version": 1,
  "provider": "google | microsoft",
  "capability": "interactive-pkce-only",
  "flow": "companion-owned-pkce"
}
```

That event contains no password, authorization URL, `state`, `code_verifier`,
code, token, client secret, email, or profile. The event cannot start or
complete a session by itself; only the direct `start` call on the trusted
companion can do so. Envelopes declare `renewalRequired: true`: the current
client has no silent renewal or unattended-sync promise.

!!! note "What linked means today"

    A Google or Microsoft identity can be linked locally to the vault
    protector. It does not install a remote connector or grant calendar access.
    Until an adapter is both configured and implemented, operations remain
    local.

!!! tip "Unlinking a provider"

    From a Google or Microsoft session, **Unlink** removes that device's
    encrypted token envelope and external identity, then returns to the local
    vault protector. It does not call the provider or delete local projects;
    those are separate, explicit operations.

## Errors, offline operation, and tests

- Password, storage, Web Crypto, format, and integrity errors never unlock the
  vault. UI messages must not include passwords, tokens, OAuth codes, or event
  contents.
- Without a network, existing local accounts and projects remain available
  within validated scientific resources. Google and Microsoft are disabled
  before the companion starts; Orbit does not open a browser or reactivate an
  external session.
- The library rejects unsupported schemas, the wrong owner, inconsistent
  revisions, and ciphertext it cannot verify.
- Unit tests cover derivation/encryption, rejected formats and credentials,
  invalidation after `logout`, cross-user isolation, encrypted library
  persistence, Planner preferences, and the companion UI contract, including
  the `enabled: true` + `start` requirement and rejection of event-only
  completion. Companion integration tests and remote-sync tests belong with
  the adapter that implements them.

## Provider references

- [Google: OAuth for desktop applications](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google: choose an authorization model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)
- [Microsoft: Authorization Code with PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft: redirect URI restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)

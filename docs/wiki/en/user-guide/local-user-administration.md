# Local user administration

[Home](../index.md) · [User Guide](index.md) · [Identity and linked projects](identity-projects.md)

Orbit user administration is **per installation**. It controls the accounts and
projects that exist in this browser or local container; it does not create a
global Orbit directory, contact a user server, or grant access to Google or
Microsoft accounts outside this device.

!!! warning "This is not a remote administration console"

    There is no Orbit master account, support credential, default password, or
    email-based recovery mechanism. The administrative reset described below
    exists only in the same installation and only for accounts that have
    enrolled their local recovery key. Clearing browser data, moving a project
    to another device, or losing all local administration cannot be resolved by
    a backend.

## Scope and least-knowledge rule

An installation can retain local administrative metadata for its own accounts.
That metadata is not part of the email selector or the initial availability
response. Before a vault is unlocked, the interface may receive only one of
these results:

| Result | Permitted meaning | What it does not disclose |
| --- | --- | --- |
| `exists: true` | A matching local selector exists. | Role, name, projects, lock state, or linked provider. |
| `exists: false` | No matching local selector exists in this installation. | Whether that identity exists on another device or provider. |
| `exists: null` | The installation cannot safely inspect the selector. | Whether the account exists, is locked, or has privileges. |

Lock state and any role are consulted only after cryptographic password
verification. A locked account returns the specific `ACCOUNT_LOCKED` error to
the person who reaches that authentication point; the pre-unlock lookup still
cannot reveal a lock, role, profile, or projects, so it is not an oracle for
enumerating installation policy.

## Safe administration bootstrap

A new installation has no preconfigured administrative password. Bootstrap uses
the reserved local identifier `admin@orbit.com`, but only as the initial local
administration route: it is not a credential and cannot open the application by
itself. Enrolment is a deliberate local action:

1. The operator chooses the first password for `admin@orbit.com`; Orbit does
   not accept a password supplied by code, an environment variable, or a
   template.
2. Under the same vault-write lock, the operation confirms that local
   administration has not already been initialized.
3. Only then is the initial administration role recorded within the encrypted
   storage of that installation. Two tabs cannot both acquire the initial role:
   Web Locks coordinates modern browsers and the process retains a local queue
   as a fallback.
4. The session remains memory-only. Restarting Orbit requires unlocking an
   account again; there is no silent administrative sign-in.

Bootstrap is not triggered by entering another known email, by a linked OAuth
identity, or by importing a project file. The pre-unlock selector lookup also
does not disclose that `admin@orbit.com` has a special role. Google and
Microsoft can identify an operator at their provider, but neither replaces the
local protector nor grants installation administration.

## Local roles and account lock

Roles are strictly local in scope. An administrator can manage accounts in this
installation according to the enabled policy, but cannot inspect passwords,
keys, tokens, another browser's files, or an external-provider account.

When an account is locked, Orbit must:

- invalidate its in-memory session and vault capabilities;
- block new sign-in and project operations by that account in the installation;
- retain its encrypted vault and projects without deleting them; and
- reject locking the last active administrator unless administration has first
  been transferred to another local account.

Locking does not erase data, revoke a Google or Microsoft provider session, or
close a session that remains open on another device. Permanently removing local
information is a separate, visible, confirmed deletion action.

## Administration panel

Signing in with an account whose local role is `admin` opens an isolated
management workspace: Orbit does not mount the viewer, open the project
library, or offer orbit controls. The directory lets an administrator:

- search by display name or email/identity;
- inspect Local, Google or Microsoft provider, last sign-in, lock state, and
  pending requests, plus current failures and the failures preceding the last
  successful sign-in;
- lock or unlock, add a private operator note, and delete an account with
  confirmation;
- require that a person changes their password on the next sign-in; and
- set a compatible user's new local password without viewing, copying, or
  exporting the current password; and
- configure the number of failed local attempts before an account is locked.

Notes, roles, attempt counters, and requests are not stored in the public
account index. They are part of this installation's encrypted administrative
directory.

`Current attempts` is the streak of failed local attempts since the last
successful sign-in. `Failures before last success` preserves that streak just
before the latest successful sign-in reset it. A direct reset clears the
current streak and unlocks the account; it does not erase the historic value
for the latest successful sign-in.

!!! note "Existing accounts"

    A local account created before administration is enabled joins the
    directory and enrols its local recovery key after its next successful
    sign-in. Until then, a direct reset fails closed without changing data; use
    the forced change on the next valid sign-in. Orbit does not decrypt other
    vaults just to reconstruct a list of emails, names, or projects.

## Password request and reset

Orbit never knows or reconstructs a local password. There are two separate
local routes, with no email or backend:

1. **Identified request.** Selecting “Forgot your password?” explicitly asks
   for an email or identifier. If it matches a local account, Orbit records a
   minimal request for the administration panel. It returns the same generic
   response for an absent, malformed, or existing account, so the action cannot
   enumerate users. An administrator may mark the request handled or require a
   change at the next valid sign-in.
2. **Direct reset.** An authenticated administrator can set a new password for
   another local account that has enrolled recovery. This route cannot change
   the administrator's own password. Orbit clears the pending request, lock,
   and current failure streak, and the account holder uses the new password at
   the next sign-in.

To preserve data, the installation keeps an unextractable AES `CryptoKey` for
each enrolled account in IndexedDB; the encrypted directory holds only an
opaque reference which is not exposed to the UI or exports. During a reset,
Orbit uses that key internally to re-encrypt the account vault, projects in all
of its partitions — including active or removed Google/Microsoft identities
that retain projects — and provider token envelopes. The interface receives
neither the prior password, the key,
nor project content, and no administrative API returns them.

Unlinking a provider removes its token and active link, but does not
automatically erase its local projects. Orbit privately stores the opaque
partition identifier in encrypted account data so a later password change can
re-encrypt it; relinking the same identity keeps those projects available. To
erase that data, delete the projects explicitly or zeroize the installation.

Changes are staged with encrypted-envelope rollback if the operation cannot be
confirmed. Before replacing projects, Orbit records an encrypted local journal.
If the browser stops before the new vault is written, the next sign-in or
administrative reset restores the earlier envelopes; if the candidate vault was
written but the directory commit was not, it finishes that commit. If rollback
of any project cannot be proven complete, Orbit retains the journal and
candidate key rather than declaring a mixed state safe: the next authenticated
access cryptographically distinguishes the old and candidate vaults, then
restores or finalizes the migration before exposing projects.

On confirmation, credential generation invalidates previously issued sessions
and vault capabilities for the target account. An earlier session cannot keep
updating the profile, opening projects, re-entering Google/Microsoft, or
reading, storing, or removing its token envelopes: its next protected operation
returns `ACCOUNT_PASSWORD_RESET`. Likewise, a forced-change marker returns
`PASSWORD_CHANGE_REQUIRED` for every workspace operation until
`changeLocalPassword` completes; that session cannot modify data in the
meantime. Orbit does not change a Google or Microsoft password, recover data on
another device, or send email.

!!! warning "Local recovery authority"

    The unextractable key prevents Orbit from copying out a password or key,
    but an administrator of the same installation has local authority to
    recover and re-encrypt enrolled accounts. This is not password-only
    end-to-end confidentiality against privileged same-origin code or the local
    browser profile. Zeroize removes these recovery keys too. If no local
    administrator remains able to operate, Orbit cannot bypass that condition.

## Operational limits

- Administrative data, accounts, and projects live on the device and local
  Orbit origin. They are not synchronized across installations.
- Encryption protects persisted data from a passive storage copy, not from
  malicious code running in the same origin while a session is open. A desktop
  container and operating-system credential store are needed for that stronger
  boundary. Local administrative recovery extends that authority to the
  installation administrator for enrolled accounts.
- There is no central audit log, user telemetry, or email notification. Any
  available operational history is local and subject to the same installation
  encryption and deletion policy.
- An `.orbit.json` or `.ics` export is an explicit, readable hand-off; it does
  not carry sessions, roles, passwords, or provider tokens.
- Planning, propagation, and BIT still require an unlocked account and valid
  scientific state. A local role does not bypass those validations.

## Contracts to validate

Identity and administration tests must at least prove that:

- no default administrative credential exists and a new instance does not
  restore sessions;
- concurrent bootstrap does not create two initial administrators;
- the pre-unlock lookup does not reveal roles, locks, profiles, or projects;
- locking invalidates the session/capability without deleting the encrypted
  project, and later access returns `ACCOUNT_LOCKED` after password
  verification;
- a reset request contains no password and changes no credentials on its own;
- direct reset rejects the old password, accepts the new one, migrates the
  vault, local/linked projects, and provider envelopes, and rolls its changes
  back on failure;
- a legacy account without a recovery key fails closed until a successful
  sign-in; recovery references and credential generations never reach the UI
  or exports;
- existing sessions and a concurrent tab cannot overwrite a confirmed rotation
  or access projects, linked identities, or tokens, and both attempt-streak
  values preserve their semantics; and
- an interruption before or after the candidate vault is persisted restores
  prior projects or deterministically completes the rotation. An uncertain
  project rollback retains the journal until that recovery without exposing the
  journal or keys to the UI; and
- no administration route performs `fetch`, records telemetry, or sends email,
  tokens, or events to an Orbit backend.

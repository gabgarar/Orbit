# Local user administration

[Home](../index.md) · [User Guide](index.md) · [Identity and linked projects](identity-projects.md)

Orbit user administration is **per installation**. It controls the accounts and
projects that exist in this browser or local container; it does not create a
global Orbit directory, contact a user server, or grant access to Google or
Microsoft accounts outside this device.

!!! warning "This is not a remote administration console"

    There is no Orbit master account, support credential, default password, or
    email-based recovery mechanism. Clearing browser data, losing every local
    administrator password, or moving a project to another device cannot be
    resolved by a backend: recovery depends on a copy or export explicitly kept
    by the operator.

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
  pending requests;
- lock or unlock, add a private operator note, and delete an account with
  confirmation;
- require that a person changes their password on the next sign-in; and
- configure the number of failed local attempts before an account is locked.

Notes, roles, attempt counters, and requests are not stored in the public
account index. They are part of this installation's encrypted administrative
directory.

!!! note "Existing accounts"

    A local account created before administration is enabled joins the
    directory after its next successful sign-in. Orbit does not decrypt other
    vaults just to reconstruct a list of emails, names, or projects; that
    boundary preserves the confidentiality of the earlier storage.

## Requested reset

Orbit never knows or reconstructs a local password. A reset is therefore a
**pending local request**, not an email link or an administrative password
replacement.

1. The operator requests a reset on the same installation.
2. Orbit records a minimal local request until an administrator marks it as
   handled. It never stores a new password or authentication data in
   plaintext.
3. An authenticated administrator may mark it handled or require a password
   change in that installation. The latter only marks a change for the next
   successful sign-in; it cannot decrypt another person's vault or choose
   their password.
4. On the next sign-in with the current password, Orbit asks for a new password
   and re-encrypts the vault with it. Marking the request handled without
   forcing a change modifies neither the vault nor its projects.

An account that does not know its password cannot cryptographically recover its
vault through an administrator. The request can force a change for a password
the operator can still prove; it does not replace that flow. If no local
administrator remains able to approve it, Orbit cannot bypass that condition.

## Operational limits

- Administrative data, accounts, and projects live on the device and local
  Orbit origin. They are not synchronized across installations.
- Encryption protects persisted data from a passive storage copy, not from
  malicious code running in the same origin while a session is open. A desktop
  container and operating-system credential store are needed for that stronger
  boundary.
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
- handling a request can only force a change after a valid sign-in; it does not
  let an administrator decrypt or re-password another vault; and
- no administration route performs `fetch`, records telemetry, or sends email,
  tokens, or events to an Orbit backend.

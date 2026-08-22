import assert from "node:assert/strict";
import test from "node:test";

import {
    identityStateForProvider,
    IDENTITY_STATES,
    isAuthenticatedIdentityState,
    isExternalIdentityState,
    normalizeIdentityState
} from "../../js/features/identity/identityStates.js";

test("identity states are explicit and unknown state never grants access", () => {
    assert.equal(normalizeIdentityState(" GOOGLE_USER "), IDENTITY_STATES.GOOGLE_USER);
    assert.equal(normalizeIdentityState("administrator"), IDENTITY_STATES.UNAUTHENTICATED);
    assert.equal(isAuthenticatedIdentityState(IDENTITY_STATES.LOCAL_USER), true);
    assert.equal(isAuthenticatedIdentityState(IDENTITY_STATES.MICROSOFT_USER), true);
    assert.equal(isAuthenticatedIdentityState("administrator"), false);
    assert.equal(isExternalIdentityState(IDENTITY_STATES.GOOGLE_USER), true);
    assert.equal(isExternalIdentityState(IDENTITY_STATES.LOCAL_USER), false);
    assert.equal(identityStateForProvider("microsoft"), IDENTITY_STATES.MICROSOFT_USER);
    assert.equal(identityStateForProvider("unknown"), IDENTITY_STATES.UNAUTHENTICATED);
});

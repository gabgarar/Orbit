import assert from "node:assert/strict";
import test from "node:test";

import {
    createPkceAuthorizationRequest,
    getOAuthProviderAvailability,
    OAUTH_PROVIDER_CAPABILITIES,
    pkceCodeChallenge,
    validateOAuthPkceConfiguration,
    validatePkceAuthorizationCallback
} from "../../js/features/identity/oauthPkce.js";

const GOOGLE_CONFIG = {
    provider: "google",
    clientId: "orbit-demo.apps.googleusercontent.com",
    redirectUri: "https://orbit.example.test/oauth/callback",
    scopes: ["openid", "email", "profile"]
};

function rejectsWithCode(code) {
    return (error) => error?.code === code;
}

test("OAuth PKCE configuration accepts public browser settings and forbids any client secret", () => {
    const config = validateOAuthPkceConfiguration(GOOGLE_CONFIG);
    assert.equal(config.provider, "google");
    assert.equal(config.authorizationEndpoint, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.deepEqual(config.scopes, ["openid", "email", "profile"]);
    assert.throws(
        () => validateOAuthPkceConfiguration({ ...GOOGLE_CONFIG, clientSecret: "never-in-a-browser" }),
        rejectsWithCode("OAUTH_CLIENT_SECRET_FORBIDDEN")
    );
    assert.throws(
        () => validateOAuthPkceConfiguration({ ...GOOGLE_CONFIG, redirectUri: "http://orbit.example.test/callback" }),
        rejectsWithCode("OAUTH_REDIRECT_INVALID")
    );
    assert.equal(validateOAuthPkceConfiguration({
        provider: "microsoft",
        clientId: "00000000-0000-0000-0000-000000000000",
        redirectUri: "http://127.0.0.1:43110/oauth"
    }).provider, "microsoft");
});

test("PKCE request has S256, a high-entropy state, and never contains a client secret", async () => {
    const request = await createPkceAuthorizationRequest(GOOGLE_CONFIG);
    const url = new URL(request.authorizationUrl);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), await pkceCodeChallenge(request.codeVerifier));
    assert.equal(url.searchParams.get("state"), request.state);
    assert.equal(request.capability, OAUTH_PROVIDER_CAPABILITIES.INTERACTIVE_PKCE_ONLY);
    assert.equal(request.renewalRequired, true);
    assert.equal(request.authorizationUrl.includes("secret"), false);

    const callback = validatePkceAuthorizationCallback(`https://orbit.example.test/oauth/callback?code=authorization-code&state=${request.state}`, request.state);
    assert.deepEqual(callback, { code: "authorization-code", state: request.state });
    assert.throws(
        () => validatePkceAuthorizationCallback("https://orbit.example.test/oauth/callback?code=authorization-code&state=wrong-state-value", request.state),
        rejectsWithCode("OAUTH_STATE_MISMATCH")
    );
});

test("external OAuth is unavailable offline and never claims persistent browser refresh capability", () => {
    const offline = getOAuthProviderAvailability(GOOGLE_CONFIG, { online: false });
    assert.deepEqual(offline, {
        provider: "google",
        available: false,
        capability: OAUTH_PROVIDER_CAPABILITIES.OFFLINE_UNAVAILABLE,
        reason: "offline",
        renewalRequired: true
    });
    const online = getOAuthProviderAvailability(GOOGLE_CONFIG, { online: true });
    assert.equal(online.available, true);
    assert.equal(online.capability, OAUTH_PROVIDER_CAPABILITIES.INTERACTIVE_PKCE_ONLY);
    assert.equal(online.renewalRequired, true);
    assert.equal(online.reason, "interactive-sign-in-required");
    const invalid = getOAuthProviderAvailability({ provider: "google", clientId: "bad" }, { online: true });
    assert.equal(invalid.available, false);
    assert.equal(invalid.capability, OAUTH_PROVIDER_CAPABILITIES.CONFIGURATION_INVALID);
});

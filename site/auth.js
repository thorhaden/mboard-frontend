// Sign-in with Amazon Cognito's Managed Login, using the authorization code flow with PKCE:
//   1. The page sends the browser to Cognito's sign-in page, with a hash of a random secret (the
//      code verifier) and a random state value.
//   2. After signing in, Cognito sends the browser back here with ?code=...&state=...
//   3. The page swaps the code for tokens at Cognito's token endpoint, proving with the verifier that
//      it's the same page that started the sign-in. A stolen code is useless without it.
// The access token goes in the Authorization header of API calls; API Gateway checks it. It's valid
// for an hour, and the refresh token gets a new one without signing in again, for 30 days.
//
// config.js sets AUTH_CONFIG to { url, clientId }. The deploy script writes it from the infra
// stack's settings. Locally it's null: there's no sign-in, and the local API uses its DEV_USER.
const auth = (() => {
  const config = window.AUTH_CONFIG;
  // Must match a callback URL of the Cognito app client exactly.
  const REDIRECT_URI = `${location.origin}/`;
  // localStorage: tokens survive closing the tab, so you stay signed in. Any script on the page can
  // read them, which is why nothing here may ever insert user input as HTML.
  const TOKENS_KEY = "mboard-tokens";
  // sessionStorage: the state and code verifier, kept only while Cognito's page is open.
  const PENDING_KEY = "mboard-sign-in";
  // Refresh a bit before the access token expires, so it doesn't expire on its way to the API.
  const EXPIRY_MARGIN_MS = 60 * 1000;

  let tokens = null; // { access, refresh, expiresAt }
  try { tokens = JSON.parse(localStorage.getItem(TOKENS_KEY)); } catch {}

  function saveTokens(value) {
    tokens = value;
    try {
      if (value) localStorage.setItem(TOKENS_KEY, JSON.stringify(value));
      else localStorage.removeItem(TOKENS_KEY);
    } catch {}
  }

  const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const randomString = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

  // A JWT's payload: who the token is for. Not verified here; the API Gateway does that.
  function claims(jwt) {
    const payload = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
  }

  async function redirectToSignIn() {
    const verifier = randomString();
    const state = randomString();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: REDIRECT_URI,
      scope: "openid",
      state,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });
    location.assign(`${config.url}/oauth2/authorize?${params}`);
    return new Promise(() => {}); // never settles: the page is being replaced
  }

  async function tokenRequest(params) {
    const res = await fetch(`${config.url}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, ...params }),
    });
    if (!res.ok) throw new Error(`token request failed, HTTP ${res.status}`);
    const body = await res.json();
    saveTokens({
      access: body.access_token,
      refresh: body.refresh_token ?? tokens?.refresh, // a refresh doesn't return a new refresh token
      expiresAt: Date.now() + body.expires_in * 1000,
    });
  }

  // Step 3: Cognito sent the browser back with a code (or an error).
  async function finishSignIn(params) {
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)); } catch {}
    sessionStorage.removeItem(PENDING_KEY);
    history.replaceState(null, "", location.pathname); // a code can only be used once; don't keep it in the URL
    if (params.has("error")) throw new Error(params.get("error_description") || params.get("error"));
    // The state proves this answer belongs to a sign-in this tab started.
    if (!pending || params.get("state") !== pending.state) throw new Error("unexpected sign-in response");
    await tokenRequest({
      grant_type: "authorization_code",
      code: params.get("code"),
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    });
  }

  // A valid access token, refreshed if needed. Without a usable refresh token, it sends the browser to
  // sign in, and never returns. With refresh: true, it gets a new token even if this one looks valid,
  // e.g. after the API rejected it.
  async function token({ refresh = false } = {}) {
    if (!config) return null;
    if (tokens && !refresh && tokens.expiresAt - Date.now() > EXPIRY_MARGIN_MS) return tokens.access;
    if (tokens?.refresh) {
      try {
        await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh });
        return tokens.access;
      } catch {} // expired or revoked: sign in again
    }
    saveTokens(null);
    return redirectToSignIn();
  }

  // Called once when the page loads. Returns the signed-in username, or null when run locally.
  async function start() {
    if (!config) return null;
    const params = new URLSearchParams(location.search);
    if (params.has("code") || params.has("error")) await finishSignIn(params);
    return claims(await token()).username;
  }

  // Ends the session in this browser and at Cognito, which then sends the browser back here.
  function signOut() {
    if (!config) return;
    if (tokens?.refresh) {
      // A revoked refresh token can't get new access tokens. The current access token still works at
      // the API until it expires, since API Gateway only checks signature and expiry. keepalive lets
      // the request finish while the page navigates away.
      fetch(`${config.url}/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refresh, client_id: config.clientId }),
        keepalive: true,
      }).catch(() => {});
    }
    saveTokens(null);
    const params = new URLSearchParams({ client_id: config.clientId, logout_uri: REDIRECT_URI });
    location.assign(`${config.url}/logout?${params}`);
  }

  return { start, token, signOut };
})();

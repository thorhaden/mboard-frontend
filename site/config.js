// Sign-in settings, read by auth.js. This committed version is for running locally: no sign-in,
// and the local API uses its DEV_USER. scripts/deploy.sh replaces it with the deployed stack's
// Cognito settings: window.AUTH_CONFIG = { url: "https://<prefix>.auth.<region>.amazoncognito.com", clientId: "..." }
window.AUTH_CONFIG = null;

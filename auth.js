import { SPOTIFY_CONFIG } from "./config.js";

const TOKEN_KEY = "pulse_spotify_token";
const VERIFIER_KEY = "pulse_code_verifier";

function randomString(length = 64) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);

  for (let i = 0; i < array.length; i++) {
    result += chars[array[i] % chars.length];
  }

  return result;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createCodeChallenge(verifier) {
  const hashed = await sha256(verifier);
  return base64UrlEncode(hashed);
}

export function getStoredToken() {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.access_token || !parsed.expires_at) return null;

    if (Date.now() >= parsed.expires_at) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

export async function loginWithSpotify() {
  const verifier = randomString(64);
  const challenge = await createCodeChallenge(verifier);

  localStorage.setItem(VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_CONFIG.scopes.join(" ")
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function handleSpotifyCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`Spotify authorization failed: ${error}`);
  }

  if (!code) return null;

  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    throw new Error("Missing PKCE verifier.");
  }

  const body = new URLSearchParams({
    client_id: SPOTIFY_CONFIG.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_CONFIG.redirectUri,
    code_verifier: verifier
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const tokenData = await response.json();

  const stored = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
    expires_at: Date.now() + tokenData.expires_in * 1000
  };

  localStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
  localStorage.removeItem(VERIFIER_KEY);

  url.searchParams.delete("code");
  url.searchParams.delete("error");
  window.history.replaceState({}, document.title, url.pathname);

  return stored;
}

export async function spotifyFetch(endpoint, accessToken, options = {}) {
  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  if (response.status === 401) {
    clearToken();
    throw new Error(`Spotify API error 401: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`Spotify API error ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}
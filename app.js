import { APP_CONFIG } from "./config.js";
import {
  loginWithSpotify,
  handleSpotifyCallback,
  getStoredToken,
  clearToken,
  spotifyFetch
} from "./auth.js";

const appState = {
  activeTab: localStorage.getItem("pulse_active_tab") || "artists",
  activeRange: localStorage.getItem("pulse_active_range") || "short_term",
  theme: localStorage.getItem("pulse_theme") || APP_CONFIG.defaultTheme,
  token: null,
  user: null,
  cache: {
    artists: {},
    songs: {},
    albums: {}
  }
};

const loginScreen = document.getElementById("loginScreen");
const appShell = document.getElementById("appShell");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const statsList = document.getElementById("statsList");
const sectionTitle = document.getElementById("sectionTitle");
const sectionDescription = document.getElementById("sectionDescription");
const playlistBtn = document.getElementById("playlistBtn");
const settingsModal = document.getElementById("settingsModal");
const detailModal = document.getElementById("detailModal");
const detailTitle = document.getElementById("detailTitle");
const detailBody = document.getElementById("detailBody");
const loadingBox = document.getElementById("loadingBox");
const errorBox = document.getElementById("errorBox");

const tabButtons = document.querySelectorAll(".tab-btn");
const rangeButtons = document.querySelectorAll(".range-btn");
const themeButtons = document.querySelectorAll(".theme-btn");

const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const closeDetailBtn = document.getElementById("closeDetailBtn");
const settingsModalCard = document.querySelector("#settingsModal .modal-card");
const detailModalCard = document.querySelector("#detailModal .modal-card");

function showLogin(message = "") {
  loginScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
  loginError.textContent = message;
}

function showApp() {
  loginScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function setLoading(isLoading) {
  loadingBox.classList.toggle("hidden", !isLoading);
  statsList.classList.toggle("hidden", isLoading);
}

function setError(message = "") {
  errorBox.textContent = message;
  errorBox.classList.toggle("hidden", !message);
}

function setTheme(theme) {
  appState.theme = theme;
  localStorage.setItem("pulse_theme", theme);

  document.body.classList.toggle("light", theme === "light");

  themeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === theme);
  });
}

function updateUserUI(user) {
  document.getElementById("userName").textContent = user.display_name || "Spotify User";
  document.getElementById("userEmail").textContent = user.email || "No email available";
  document.getElementById("userAvatar").src = user.images?.[0]?.url || "assets/logo.svg";

  document.getElementById("settingsName").textContent =
    user.display_name || "Spotify User";
  document.getElementById("settingsEmail").textContent =
    user.email || "No email available";
  document.getElementById("settingsPlan").textContent =
    user.product || "Unknown";
}

function getHeading() {
  return {
    artists: {
      title: "Top Artists",
      description: "Your most listened-to artists in the selected time range."
    },
    songs: {
      title: "Top Songs",
      description: "Tracks that dominate your listening stats right now."
    },
    albums: {
      title: "Top Albums",
      description: "Albums calculated from your top Spotify tracks."
    }
  }[appState.activeTab];
}

function rangeLabel(range) {
  return {
    short_term: "4 WEEKS",
    medium_term: "6 MONTHS",
    long_term: "1 YEAR"
  }[range];
}

async function fetchUserProfile() {
  const data = await spotifyFetch("/me", appState.token.access_token);
  appState.user = data;

  console.log("Fetched /me profile:", data);
  console.log("ID:", data.id);
  console.log("Display name:", data.display_name);

  updateUserUI(data);
}

async function fetchTopArtists(range) {
  if (appState.cache.artists[range]) return appState.cache.artists[range];

  const data = await spotifyFetch(
    `/me/top/artists?time_range=${range}&limit=${APP_CONFIG.itemsLimit}`,
    appState.token.access_token
  );

  const items = Array.isArray(data.items) ? data.items : [];

  const normalized = items.map((artist, index) => {
    const followers = artist?.followers?.total ?? 0;
    const genres = Array.isArray(artist?.genres) ? artist.genres : [];
    const image = artist?.images?.[0]?.url || "assets/logo.svg";

    return {
      type: "artist",
      id: artist.id,
      rank: index + 1,
      title: artist.name || "Unknown artist",
      subtitle: `${followers.toLocaleString("cs-CZ")} followers • ${
        genres.length ? genres.slice(0, 2).join(" / ") : "No genres"
      }`,
      image,
      raw: artist
    };
  });

  appState.cache.artists[range] = normalized;
  return normalized;
}

async function fetchTopSongs(range) {
  if (appState.cache.songs[range]) return appState.cache.songs[range];

  const data = await spotifyFetch(
    `/me/top/tracks?time_range=${range}&limit=${APP_CONFIG.itemsLimit}`,
    appState.token.access_token
  );

  const items = Array.isArray(data.items) ? data.items : [];

  const normalized = items.map((track, index) => ({
    type: "track",
    id: track.id,
    uri: track.uri,
    rank: index + 1,
    title: track.name,
    subtitle: `${track.artists.map((a) => a.name).join(", ")} • ${track.album.name}`,
    image: track.album.images?.[0]?.url || "assets/Pulse_Logo.png",
    raw: track
  }));

  appState.cache.songs[range] = normalized;
  return normalized;
}

async function fetchTopAlbums(range) {
  if (appState.cache.albums[range]) return appState.cache.albums[range];

  const tracks = await fetchTopSongs(range);
  const albumMap = new Map();

  for (const item of tracks) {
    const track = item.raw;
    const album = track?.album;
    if (!album?.id) continue;

    if (!albumMap.has(album.id)) {
      albumMap.set(album.id, {
        type: "album",
        id: album.id,
        rankScore: 0,
        title: album.name || "Unknown album",
        subtitle: `${track.artists.map((a) => a.name).join(", ")} • ${
          album.release_date || "Unknown release"
        }`,
        image: album.images?.[0]?.url || "assets/Pulse_Logo.png",
        raw: {
          album,
          tracks: []
        }
      });
    }

    const existing = albumMap.get(album.id);
    existing.rankScore += 1;
    existing.raw.tracks.push(track.name);
  }

  const normalized = [...albumMap.values()]
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, APP_CONFIG.itemsLimit)
    .map((albumItem, index) => ({
      ...albumItem,
      rank: index + 1,
      subtitle: `${albumItem.raw.album.artists.map((a) => a.name).join(", ")} • ${
        albumItem.rankScore
      } top track${albumItem.rankScore === 1 ? "" : "s"}`
    }));

  appState.cache.albums[range] = normalized;
  return normalized;
}

async function getCurrentItems() {
  if (appState.activeTab === "artists") {
    return fetchTopArtists(appState.activeRange);
  }

  if (appState.activeTab === "songs") {
    return fetchTopSongs(appState.activeRange);
  }

  return fetchTopAlbums(appState.activeRange);
}

function renderStats(items) {
  const heading = getHeading();

  sectionTitle.textContent = heading.title;
  sectionDescription.textContent = heading.description;
  playlistBtn.classList.toggle("hidden", appState.activeTab !== "songs");

  statsList.innerHTML = items
    .map((item) => {
      const visual = `<img class="stat-image" src="${item.image}" alt="${item.title}" />`;

      return `
        <article class="stat-card">
          <div class="rank-badge">#${item.rank}</div>
          <div class="stat-main">
            ${visual}
            <div class="stat-copy">
              <h3>${item.title}</h3>
              <p>${item.subtitle}</p>
            </div>
          </div>
          <button class="detail-btn" data-type="${item.type}" data-id="${item.id}">
            Detail
          </button>
        </article>
      `;
    })
    .join("");
}

async function loadAndRenderCurrentTab() {
  try {
    setError("");
    setLoading(true);

    const items = await getCurrentItems();

    if (!items || !items.length) {
      statsList.classList.remove("hidden");
      statsList.innerHTML = `
        <div class="empty-state">
          No data available for this section in the selected time range.
        </div>
      `;
      return;
    }

    renderStats(items);
    statsList.classList.remove("hidden");
  } catch (error) {
    setError(error.message || "Something went wrong while loading Spotify data.");
    statsList.classList.remove("hidden");
    statsList.innerHTML = `
      <div class="empty-state">
        Failed to load data for this section.
      </div>
    `;
    showToast("Loading failed", error.message || "Unknown error", "error");
  } finally {
    setLoading(false);
  }
}

function setActiveTab(tab) {
  appState.activeTab = tab;
  localStorage.setItem("pulse_active_tab", tab);

  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  loadAndRenderCurrentTab();
}

function setActiveRange(range) {
  appState.activeRange = range;
  localStorage.setItem("pulse_active_range", range);

  rangeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.range === range);
  });

  loadAndRenderCurrentTab();
}

async function createPlaylistFromTopTracks() {
  playlistBtn.disabled = true;
  playlistBtn.textContent = "Creating...";

  try {
    const tracks = await fetchTopSongs(appState.activeRange);
    const uris = tracks
      .map((track) => track?.uri)
      .filter(Boolean)
      .slice(0, 20);

    if (!uris.length) {
      throw new Error("No tracks available for playlist creation.");
    }

    console.log("Top track URIs:", uris);

    const playlist = await spotifyFetch(
      `/me/playlists`,
      appState.token.access_token,
      {
        method: "POST",
        body: JSON.stringify({
          name: `TOP TRACKS - ${rangeLabel(appState.activeRange)}`,
          description: "Created by PULSE",
          public: false
        })
      }
    );

    console.log("Playlist created:", playlist);

    const addItemsResult = await spotifyFetch(
      `/playlists/${playlist.id}/items`,
      appState.token.access_token,
      {
        method: "POST",
        body: JSON.stringify({
          uris
        })
      }
    );

    console.log("Items added:", addItemsResult);

    showToast(
      "Playlist created",
      `${playlist.name} was successfully added to your Spotify account.`,
      "success"
    );
  } catch (error) {
    console.error("Playlist flow failed:", error);
    showToast("Playlist error", error.message || "Unknown error", "error");
  } finally {
    playlistBtn.disabled = false;
    playlistBtn.textContent = "Create Playlist";
  }
}

function findItemById(type, id) {
  const rangeCache =
    type === "artist"
      ? appState.cache.artists[appState.activeRange]
      : type === "track"
        ? appState.cache.songs[appState.activeRange]
        : appState.cache.albums[appState.activeRange];

  return rangeCache?.find((item) => item.id === id);
}

function openDetail(type, id) {
  const item = findItemById(type, id);
  if (!item) return;

  detailTitle.textContent = item.title;

  if (type === "track") {
    const track = item.raw;
    const artistNames = track.artists.map((a) => a.name).join(", ");
    const duration = `${Math.floor(track.duration_ms / 60000)}:${String(
      Math.floor((track.duration_ms % 60000) / 1000)
    ).padStart(2, "0")}`;

    detailBody.innerHTML = `
      <div class="detail-hero">
        <img
          class="detail-cover"
          src="${track.album.images?.[0]?.url || "assets/logo.svg"}"
          alt="${track.name}"
        />
        <div class="detail-hero-copy">
          <h4>${track.name}</h4>
          <p>${artistNames}</p>
        </div>
      </div>

      <div class="detail-meta">
        <div class="detail-chip">Album: ${track.album.name}</div>
        <div class="detail-chip">Duration: ${duration}</div>
        <div class="detail-chip">Release: ${track.album.release_date || "Unknown"}</div>
      </div>

      <div class="detail-section">
        <p class="detail-section-title">Track details</p>
        <p>
          This song belongs to <strong>${track.album.name}</strong> and is performed by
          <strong>${artistNames}</strong>.
        </p>
      </div>

      <div class="detail-actions">
        <a
          class="detail-action-btn primary"
          href="${track.external_urls.spotify}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Spotify
        </a>
      </div>
    `;
  } else if (type === "artist") {
    const artist = item.raw;
    const genres =
      Array.isArray(artist.genres) && artist.genres.length
        ? artist.genres.join(", ")
        : "No genres available";

    detailBody.innerHTML = `
      <div class="detail-hero">
        <img
          class="detail-cover"
          src="${artist.images?.[0]?.url || "assets/logo.svg"}"
          alt="${artist.name}"
        />
        <div class="detail-hero-copy">
          <h4>${artist.name}</h4>
          <p>Popularity score: ${artist.popularity ?? "Unknown"}</p>
        </div>
      </div>

      <div class="detail-meta">
        <div class="detail-chip">
          Followers: ${(artist.followers?.total ?? 0).toLocaleString("cs-CZ")}
        </div>
        <div class="detail-chip">
          Popularity: ${artist.popularity ?? "Unknown"}
        </div>
      </div>

      <div class="detail-section">
        <p class="detail-section-title">Genres</p>
        <p>${genres}</p>
      </div>

      <div class="detail-actions">
        <a
          class="detail-action-btn primary"
          href="${artist.external_urls.spotify}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Spotify
        </a>
      </div>
    `;
  } else {
    const album = item.raw.album;
    const artistNames = Array.isArray(album.artists)
      ? album.artists.map((a) => a.name).join(", ")
      : "Unknown artist";

    const tracksPreview = item.raw.tracks?.length
      ? item.raw.tracks.slice(0, 5).join(", ")
      : "No top tracks available";

    detailBody.innerHTML = `
      <div class="detail-hero">
        <img
          class="detail-cover"
          src="${album.images?.[0]?.url || "assets/logo.svg"}"
          alt="${album.name}"
        />
        <div class="detail-hero-copy">
          <h4>${album.name}</h4>
          <p>${artistNames}</p>
        </div>
      </div>

      <div class="detail-meta">
        <div class="detail-chip">Release: ${album.release_date || "Unknown"}</div>
        <div class="detail-chip">Tracks on album: ${album.total_tracks ?? "Unknown"}</div>
        <div class="detail-chip">Your top tracks here: ${item.rankScore}</div>
      </div>

      <div class="detail-section">
        <p class="detail-section-title">Top tracks from this album</p>
        <p>${tracksPreview}</p>
      </div>

      <div class="detail-actions">
        <a
          class="detail-action-btn primary"
          href="${album.external_urls.spotify}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Spotify
        </a>
      </div>
    `;
  }

  detailModal.classList.remove("hidden");
}

const toastContainer = document.getElementById("toastContainer");

function showToast(title, message = "", type = "info", duration = 3200) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  toast.innerHTML = `
    <p class="toast-title">${title}</p>
    <p class="toast-message">${message}</p>
  `;

  toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-6px)";
    toast.style.transition = "0.2s ease";
  }, Math.max(400, duration - 220));

  window.setTimeout(() => {
    toast.remove();
  }, duration);
}

function syncInitialUIState() {
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === appState.activeTab);
  });

  rangeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.range === appState.activeRange);
  });
}

async function bootstrap() {
  setTheme(appState.theme);
  syncInitialUIState();

  const url = new URL(window.location.href);
  const hadSpotifyCode = url.searchParams.has("code");

  try {
    await handleSpotifyCallback();

    if (hadSpotifyCode) {
      sessionStorage.setItem("pulse_just_logged_in", "true");
    }
  } catch (error) {
    console.error("Callback error:", error);
    showLogin(error.message);
    return;
  }

  const token = getStoredToken();

  if (!token) {
    showLogin("");
    return;
  }

  appState.token = token;
  showApp();

  try {
    await fetchUserProfile();
    await loadAndRenderCurrentTab();

    const justLoggedIn = sessionStorage.getItem("pulse_just_logged_in");

    if (justLoggedIn === "true") {
      showToast(
        "Welcome to PULSE",
        `Logged in as ${appState.user?.display_name || "Spotify User"}.`,
        "success"
      );

      sessionStorage.removeItem("pulse_just_logged_in");
    }
  } catch (error) {
    console.error("Bootstrap error:", error);
    clearToken();
    showLogin(error.message || "Failed to initialize app.");
  }
}

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await loginWithSpotify();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveRange(button.dataset.range));
});

themeButtons.forEach((button) => {
  button.addEventListener("click", () => setTheme(button.dataset.theme));
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
});

if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsModal.classList.add("hidden");
  });
}

if (closeDetailBtn) {
  closeDetailBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    detailModal.classList.add("hidden");
  });
}

if (settingsModalCard) {
  settingsModalCard.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

if (detailModalCard) {
  detailModalCard.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) {
    settingsModal.classList.add("hidden");
  }
});

detailModal.addEventListener("click", (event) => {
  if (event.target === detailModal) {
    detailModal.classList.add("hidden");
  }
});

document.getElementById("homeBtn").addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearToken();
  window.location.reload();
});

playlistBtn.addEventListener("click", async () => {
  try {
    await createPlaylistFromTopTracks();
  } catch (error) {
    showToast("Playlist error", error.message || "Unknown error", "error");
  }
});

document.addEventListener("click", (event) => {
  const detailButton = event.target.closest(".detail-btn");
  if (!detailButton) return;
  openDetail(detailButton.dataset.type, detailButton.dataset.id);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    settingsModal.classList.add("hidden");
    detailModal.classList.add("hidden");
  }
});

bootstrap();
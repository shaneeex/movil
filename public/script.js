// @ts-nocheck
/************ PUBLIC (index.html) ************/
const VIDEO_THUMB_FALLBACK = "/static/default-video-thumb.jpg";
const PROJECTS_PER_PAGE = 12;
const DEFAULT_PROJECT_CATEGORY = "General";
const ADMIN_PROJECTS_PER_PAGE = PROJECTS_PER_PAGE;
const FEATURED_PROJECTS_LIMIT = 8;
const FEATURED_AUTOPLAY_INTERVAL = 6000;
const prefetchedAssets = new Set();
const CLOUDINARY_HOST_PATTERN = /res\.cloudinary\.com/i;
const MEDIA_TRANSFORMS = {
  grid: "f_auto,q_auto,c_fill,g_auto,w_720,h_520",
  hero: "a_auto,f_auto,q_auto,c_fill,g_auto,w_1280,h_720",
  detail: "f_auto,q_auto,c_fill,g_auto,w_960,h_720",
  thumb: "f_auto,q_auto,c_fill,g_auto,w_480,h_360",
};
const scheduleIdle =
  typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
    ? (cb) => window.requestIdleCallback(cb, { timeout: 120 })
    : (cb) => setTimeout(cb, 1);
let heroParallaxInitialized = false;
let heroParallaxFrame = null;
let projectCardObserver = null;
let sectionObserver = null;
let featuredMediaObserver = null;
let heroBlendObserver = null;
let ctaContactObserver = null;
const featuredCarouselState = { index: 0, total: 0, timer: null };
if (typeof window !== "undefined") {
  window.publicProjectsFilter = window.publicProjectsFilter || "All";
  window.publicFeaturedProjects = window.publicFeaturedProjects || [];
}

const PROJECTS_SYNC_STORAGE_KEY = "movilstudio:projects-updated";
const PROJECTS_SYNC_SOURCE =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `source-${Math.random().toString(36).slice(2)}`;
let projectsSyncChannel = null;
let projectsSyncInitialized = false;
let pendingProjectsReload = null;
let adminStatusFilter = "all";
let adminTagFilter = [];
let adminAvailableTags = [];
let adminReorderMode = false;
let adminReorderDirty = false;
let adminDraggingCard = null;
const PROJECTS_CACHE_KEY = "movilstudio:projects-cache";
const PROJECTS_CACHE_TTL = 30 * 1000;
const HERO_VIDEO_CACHE_TTL = 60 * 1000;
let heroVideoCache = null;
let heroVideoCacheTime = 0;
const HERO_VIDEO_DESKTOP_DEFAULT = { x: 50, y: 50, zoom: 1 };
const HERO_VIDEO_MOBILE_DEFAULT = { x: 50, y: 35, zoom: 1.05 };
const HERO_OVERLAY_MODES = ["aurora", "ember", "midnight", "prism", "nebula", "lumen", "noir"];
const HERO_OVERLAY_DEFAULT = HERO_OVERLAY_MODES[0];
const HERO_OVERLAY_OPACITY_MIN = 0.2;
const HERO_OVERLAY_OPACITY_MAX = 1;
const HERO_OVERLAY_OPACITY_DEFAULT = 0.85;
const HERO_FOREGROUND_OPACITY_MIN = 0;
const HERO_FOREGROUND_OPACITY_MAX = 1;
const HERO_FOREGROUND_OPACITY_DEFAULT = 1;
const HERO_BACKGROUND_OPACITY_MIN = 0;
const HERO_BACKGROUND_OPACITY_MAX = 1;
const HERO_BACKGROUND_OPACITY_DEFAULT = 0.6;
let adminHeroVideoState = null;

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return null;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function buildHeroVideoPosition(display = {}, defaults) {
  const x = clampNumber(Number(display?.x), 0, 100);
  const y = clampNumber(Number(display?.y), 0, 100);
  const zoom = clampNumber(Number(display?.zoom), 0.8, 2.2);
  return {
    x: x ?? defaults.x,
    y: y ?? defaults.y,
    zoom: zoom ?? defaults.zoom,
  };
}

function getHeroVideoDisplay(heroVideo) {
  const display = heroVideo?.display || {};
  return {
    desktop: buildHeroVideoPosition(display.desktop, HERO_VIDEO_DESKTOP_DEFAULT),
    mobile: buildHeroVideoPosition(display.mobile, HERO_VIDEO_MOBILE_DEFAULT),
  };
}

function normalizeHeroOverlayMode(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HERO_OVERLAY_MODES.includes(normalized) ? normalized : HERO_OVERLAY_DEFAULT;
}

function normalizeHeroOpacityValue(value, fallback, min, max) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampNumber(value, min, max) ?? fallback;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return clampNumber(parsed, min, max) ?? fallback;
    }
  }
  return fallback;
}

function normalizeHeroOverlayOpacity(value) {
  return normalizeHeroOpacityValue(value, HERO_OVERLAY_OPACITY_DEFAULT, HERO_OVERLAY_OPACITY_MIN, HERO_OVERLAY_OPACITY_MAX);
}

function normalizeHeroForegroundOpacity(value) {
  return normalizeHeroOpacityValue(
    value,
    HERO_FOREGROUND_OPACITY_DEFAULT,
    HERO_FOREGROUND_OPACITY_MIN,
    HERO_FOREGROUND_OPACITY_MAX,
  );
}

function normalizeHeroBackgroundOpacity(value) {
  return normalizeHeroOpacityValue(
    value,
    HERO_BACKGROUND_OPACITY_DEFAULT,
    HERO_BACKGROUND_OPACITY_MIN,
    HERO_BACKGROUND_OPACITY_MAX,
  );
}

function applyHeroOverlaySettings(heroVideo) {
  const overlay = document.querySelector("[data-hero-overlay]");
  const heroSection = document.querySelector(".hero");
  const normalizedMode = heroVideo ? normalizeHeroOverlayMode(heroVideo.overlayMode) : HERO_OVERLAY_DEFAULT;
  const normalizedOverlayOpacity = heroVideo
    ? normalizeHeroOverlayOpacity(heroVideo.overlayOpacity)
    : HERO_OVERLAY_OPACITY_DEFAULT;
  const normalizedForegroundOpacity = heroVideo
    ? normalizeHeroForegroundOpacity(heroVideo.foregroundOpacity)
    : HERO_FOREGROUND_OPACITY_DEFAULT;
  const normalizedBackgroundOpacity = heroVideo
    ? normalizeHeroBackgroundOpacity(heroVideo.backgroundOpacity)
    : HERO_BACKGROUND_OPACITY_DEFAULT;
  if (overlay) {
    HERO_OVERLAY_MODES.forEach((candidate) => {
      overlay.classList.toggle(`hero-video-overlay--${candidate}`, candidate === normalizedMode);
    });
    overlay.dataset.overlayMode = normalizedMode;
    overlay.style.setProperty("--hero-overlay-opacity", String(normalizedOverlayOpacity));
  }
  if (heroSection) {
    heroSection.style.setProperty("--hero-foreground-overlay-opacity", String(normalizedForegroundOpacity));
    heroSection.style.setProperty("--hero-background-overlay-opacity", String(normalizedBackgroundOpacity));
  }
}

function setHeroOverlayOpacityPreview(value) {
  const label = document.getElementById("heroOverlayOpacityValue");
  const normalized = normalizeHeroOverlayOpacity(value);
  if (label) {
    label.textContent = `${Math.round(normalized * 100)}%`;
  }
}

function setHeroForegroundOpacityPreview(value) {
  const label = document.getElementById("heroForegroundOpacityValue");
  const normalized = normalizeHeroForegroundOpacity(value);
  if (label) {
    label.textContent = `${Math.round(normalized * 100)}%`;
  }
}

function setHeroBackgroundOpacityPreview(value) {
  const label = document.getElementById("heroBackgroundOpacityValue");
  const normalized = normalizeHeroBackgroundOpacity(value);
  if (label) {
    label.textContent = `${Math.round(normalized * 100)}%`;
  }
}

function applyHeroVideoCssVars(video, heroVideo, fallbacks = {}) {
  if (!video) return;
  if (!heroVideo) {
    clearHeroVideoCssVars(video);
    if (fallbacks.mobilePosition) {
      video.style.setProperty("--hero-video-mobile-position", fallbacks.mobilePosition);
    }
    if (fallbacks.mobileScale) {
      video.style.setProperty("--hero-video-mobile-scale", String(fallbacks.mobileScale));
    }
    return;
  }
  const { desktop, mobile } = getHeroVideoDisplay(heroVideo);
  const desktopPosition = `${desktop.x}% ${desktop.y}%`;
  video.style.setProperty("--hero-video-desktop-position", desktopPosition);
  video.style.setProperty("--hero-video-desktop-scale", String(desktop.zoom ?? 1));

  const mobilePosition = `${mobile.x}% ${mobile.y}%`;
  video.style.setProperty("--hero-video-mobile-position", mobilePosition);
  video.style.setProperty("--hero-video-mobile-scale", String(mobile.zoom ?? HERO_VIDEO_MOBILE_DEFAULT.zoom));
}

function clearHeroVideoCssVars(video) {
  if (!video) return;
  ["--hero-video-desktop-position", "--hero-video-desktop-scale", "--hero-video-mobile-position", "--hero-video-mobile-scale"].forEach((prop) =>
    video.style.removeProperty(prop),
  );
}

function applyHeroVideoPreviewStyles(video, heroVideo) {
  if (!video) return;
  if (!heroVideo) {
    video.style.removeProperty("object-position");
    video.style.removeProperty("transform");
    return;
  }
  const { desktop } = getHeroVideoDisplay(heroVideo);
  video.style.objectFit = "cover";
  video.style.objectPosition = `${desktop.x}% ${desktop.y}%`;
  video.style.transform = `scale(${desktop.zoom || 1})`;
}

if (typeof window !== "undefined") {
  setupProjectsSync();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function readResponsePayload(res) {
  if (!res) return { data: null, text: "" };
  let text = "";
  try {
    text = await res.text();
  } catch (err) {
    return { data: null, text: "", error: err };
  }
  const trimmed = text.trim();
  if (!trimmed) return { data: null, text: "" };
  try {
    return { data: JSON.parse(trimmed), text: trimmed };
  } catch (err) {
    return { data: null, text: trimmed, error: err };
  }
}

function pickResponseErrorMessage(data, text, fallback) {
  if (data?.error) return data.error;
  if (typeof text === "string" && text && !/[<>]/.test(text)) return text;
  return fallback;
}


function getMediaThumb(media) {
  return getMediaThumbWithVariant(media, "grid");
}

function getMediaThumbWithVariant(media, variant) {
  if (!media) return VIDEO_THUMB_FALLBACK;
  const transformKey = MEDIA_TRANSFORMS[variant] ? variant : "grid";
  if (typeof media.thumbnail === "string" && media.thumbnail.trim()) {
    return optimizeMediaUrl(media.thumbnail, transformKey);
  }
  if (media.type === "video") return VIDEO_THUMB_FALLBACK;
  if (typeof media.url === "string" && media.url.trim()) {
    return optimizeMediaUrl(media.url, transformKey);
  }
  return VIDEO_THUMB_FALLBACK;
}

function clampMediaFocusValue(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function getMediaFocus(media) {
  if (!media || typeof media !== "object") return null;
  const focus = media.focus;
  if (!focus || typeof focus !== "object") return null;
  const x = clampMediaFocusValue(Number(focus.x));
  const y = clampMediaFocusValue(Number(focus.y));
  const zoomCandidate = clampMediaZoomValue(
    typeof focus.zoom === "number" ? focus.zoom : Number(focus.zoom),
  );
  if (x === null && y === null && zoomCandidate === null) return null;
  return {
    x: x === null ? 50 : x,
    y: y === null ? 50 : y,
    zoom: zoomCandidate === null ? 1 : zoomCandidate,
  };
}

function clampMediaZoomValue(value) {
  if (!Number.isFinite(value)) return null;
  const min = 1;
  const max = 2;
  if (value < min) return min;
  if (value > max) return max;
  return Math.round(value * 1000) / 1000;
}

function parseOrderInputValue(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw === null) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildMediaFocusAttr(media) {
  const focus = getMediaFocus(media);
  if (!focus) return "";
  const { x, y, zoom } = focus;
  const parts = [
    `object-position:${x}% ${y}%`,
    `--media-focus-x:${x}%`,
    `--media-focus-y:${y}%`,
    `--media-origin-x:${x}%`,
    `--media-origin-y:${y}%`,
    `--media-zoom:${zoom.toFixed(3)}`,
  ];
  return ` style="${parts.join(";")};"`;
}

function optimizeMediaUrl(url, variant = "grid") {
  if (!url || typeof url !== "string") return url;
  const transform = MEDIA_TRANSFORMS[variant] || MEDIA_TRANSFORMS.grid;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!CLOUDINARY_HOST_PATTERN.test(parsed.hostname) || !parsed.pathname.includes("/upload/")) {
      return parsed.toString();
    }
    const [prefix, suffix] = parsed.pathname.split("/upload/");
    if (!suffix) return parsed.toString();
    if (suffix.startsWith(transform)) {
      const direct = parsed.toString();
      return direct.replace(/\.hei[cf](?=(\?|$))/i, ".jpg");
    }
    parsed.pathname = `${prefix}/upload/${transform}/${suffix.replace(/^\/+/, "")}`;
    const transformed = parsed.toString();
    return transformed.replace(/\.hei[cf](?=(\?|$))/i, ".jpg");
  } catch {
    return url;
  }
}

function setupFocusOverlay(previewWrapper, overlay, focusControls, updatePreviewFocus) {
  if (!previewWrapper || !overlay || !focusControls || overlay.dataset.overlayBound) return;
  const xInput = focusControls.querySelector('input[data-focus-axis="x"]');
  const yInput = focusControls.querySelector('input[data-focus-axis="y"]');
  if (!xInput || !yInput) return;
  overlay.dataset.overlayBound = "1";

  let activePointerId = null;

  const clampPercent = (value) => Math.min(100, Math.max(0, value));

  const updateFromEvent = (event) => {
    const rect = previewWrapper.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const percentX = clampPercent(((event.clientX - rect.left) / rect.width) * 100);
    const percentY = clampPercent(((event.clientY - rect.top) / rect.height) * 100);
    xInput.value = percentX.toFixed(2);
    yInput.value = percentY.toFixed(2);
    updatePreviewFocus();
  };

  const stopDrag = () => {
    overlay.classList.remove("is-dragging");
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", stopDrag);
    activePointerId = null;
  };

  const handleMove = (event) => {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    updateFromEvent(event);
  };

  const startDrag = (event) => {
    if (!overlay.classList.contains("is-active")) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    overlay.classList.add("is-dragging");
    updateFromEvent(event);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopDrag, { once: true });
  };

  overlay.addEventListener("pointerdown", startDrag);
  previewWrapper.addEventListener("pointerdown", startDrag);
}

function findHeroMediaCandidate(mediaItems = [], heroUrl = "") {
  if (!Array.isArray(mediaItems) || !mediaItems.length) return null;
  if (heroUrl) {
    const match = mediaItems.find((media) => media?.url === heroUrl);
    if (match) return match;
  }
  const firstImage = mediaItems.find(
    (media) => media && (media.type || "").toLowerCase() !== "video",
  );
  return firstImage || null;
}

function deriveHeroMediaUrl(project) {
  const mediaItems = Array.isArray(project?.media) ? project.media : [];
  if (!mediaItems.length) return "";
  const preferred = typeof project?.heroMediaUrl === "string" ? project.heroMediaUrl.trim() : "";
  const matched = mediaItems.find((media) => media?.url === preferred);
  if (matched?.url) return matched.url;
  const firstImage = mediaItems.find(
    (media) => media && (media.type || "").toLowerCase() !== "video",
  );
  if (firstImage?.url) return firstImage.url;
  const first = mediaItems.find((media) => media?.url);
  return first?.url || "";
}

function slugifyShareTitle(title) {
  if (typeof title !== "string") return "movil-project";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "movil-project";
}

function getProjectStableKey(project, index) {
  const safeIndex = Number.isInteger(index) ? index : Number.parseInt(index, 10);
  const fallbackIndex = Number.isInteger(safeIndex) && safeIndex >= 0 ? safeIndex : 0;
  if (!project || typeof project !== "object") return `i${fallbackIndex}`;

  const createdAt = project.createdAt || project.created_at || project.created;
  const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isFinite(timestamp)) {
    return `t${timestamp.toString(36)}`;
  }

  const mediaItems = Array.isArray(project.media) ? project.media : [];
  const mediaWithId = mediaItems.find(
    (entry) =>
      entry &&
      typeof entry.cloudinaryId === "string" &&
      entry.cloudinaryId.trim(),
  );
  if (mediaWithId) {
    const cleaned = mediaWithId.cloudinaryId.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    if (cleaned) {
      return `m${cleaned.slice(-12)}`;
    }
  }

  const mediaWithUrl = mediaItems.find(
    (entry) => entry && typeof entry.url === "string" && entry.url.trim(),
  );
  if (mediaWithUrl) {
    const cleaned = mediaWithUrl.url.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    if (cleaned) {
      return `u${cleaned.slice(-12)}`;
    }
  }

  const slug = slugifyShareTitle(project.title || "");
  if (slug && slug !== "movil-project") {
    return `s${slug.slice(0, 12)}`;
  }

  return `i${fallbackIndex}`;
}

function buildProjectShareId(project, index) {
  const safeIndex = Number.isInteger(index) ? index : Number.parseInt(index, 10);
  const fallbackIndex = Number.isInteger(safeIndex) && safeIndex >= 0 ? safeIndex : 0;
  const stableKey = getProjectStableKey(project, fallbackIndex);
  const slug = slugifyShareTitle(project?.title || "");
  return `${stableKey}-${slug}`;
}

function attachFallbackToImage(img) {
  if (!img || img.dataset.thumbBound) return;
  img.dataset.thumbBound = "1";
  img.addEventListener("error", () => {
    if (img.src !== VIDEO_THUMB_FALLBACK) {
      img.src = VIDEO_THUMB_FALLBACK;
    }
  });
}

function attachFallbacks(container) {
  if (!container) return;
  container.querySelectorAll("img").forEach(attachFallbackToImage);
}

function setupProjectsSync() {
  if (projectsSyncInitialized || typeof window === "undefined") return;
  projectsSyncInitialized = true;
  if ("BroadcastChannel" in window) {
    try {
      projectsSyncChannel = new BroadcastChannel(PROJECTS_SYNC_STORAGE_KEY);
      projectsSyncChannel.addEventListener("message", (event) => {
        handleProjectsSyncEvent(event?.data);
      });
    } catch (err) {
      console.warn("BroadcastChannel unavailable:", err);
      projectsSyncChannel = null;
    }
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== PROJECTS_SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      handleProjectsSyncEvent(payload);
    } catch (err) {
      console.warn("Failed to parse storage sync payload:", err);
    }
  });
}

function handleProjectsSyncEvent(payload) {
  if (!payload || payload.source === PROJECTS_SYNC_SOURCE) return;
  if (payload.type !== "projects-updated") return;
  if (typeof document === "undefined") return;
  const grid = document.getElementById("projectsGrid");
  if (!grid) return;
  const nextPageCandidate = Number(window.publicProjectsCurrentPage) || 1;
  if (pendingProjectsReload) {
    clearTimeout(pendingProjectsReload);
  }
  pendingProjectsReload = setTimeout(() => {
    pendingProjectsReload = null;
    loadPublicProjects(nextPageCandidate).catch(console.error);
  }, 150);
  invalidateProjectsCache();
}

function broadcastProjectsUpdate(detail = {}) {
  if (typeof window === "undefined") return;
  invalidateProjectsCache();
  setupProjectsSync();
  const payload = {
    type: "projects-updated",
    source: PROJECTS_SYNC_SOURCE,
    timestamp: Date.now(),
    detail: detail || {},
  };
  if (projectsSyncChannel) {
    try {
      projectsSyncChannel.postMessage(payload);
    } catch (err) {
      console.warn("Failed to post projects sync message:", err);
    }
  }
  try {
    localStorage.setItem(PROJECTS_SYNC_STORAGE_KEY, JSON.stringify(payload));
    setTimeout(() => {
      try {
        localStorage.removeItem(PROJECTS_SYNC_STORAGE_KEY);
      } catch (err) {
        console.warn("Failed to clear projects sync storage key:", err);
      }
    }, 0);
  } catch (err) {
    console.warn("Projects sync storage unavailable:", err);
  }
}

let cloudinaryConfigPromise = null;

async function getCloudinaryConfig() {
  if (!cloudinaryConfigPromise) {
    cloudinaryConfigPromise = fetch("/api/config/cloudinary")
      .then(async (res) => {
        const { data, text } = await readResponsePayload(res);
        if (!res.ok) {
          throw new Error(pickResponseErrorMessage(data, text, "Cloudinary configuration is unavailable."));
        }
        return data;
      })
      .then((data) => {
        if (!data?.ok || !data.cloudName || !data.uploadPreset) {
          throw new Error(data?.error || "Cloudinary configuration is unavailable.");
        }
        return {
          cloudName: data.cloudName,
          uploadPreset: data.uploadPreset,
          folder: data.folder || "",
        };
      })
      .catch((err) => {
        cloudinaryConfigPromise = null;
        throw err;
      });
  }
  return cloudinaryConfigPromise;
}

function buildVideoThumbnailUrl(cloudName, publicId) {
  if (!cloudName || !publicId) return VIDEO_THUMB_FALLBACK;
  const encodedId = encodeURIComponent(publicId).replace(/%2F/g, "/");
  return `https://res.cloudinary.com/${cloudName}/video/upload/so_0/${encodedId}.jpg`;
}

function makeMediaPayloadFromUpload({ result, file, cloudName }) {
  if (!result?.secure_url) {
    throw new Error("Cloudinary did not return a secure URL.");
  }
  const resourceType = result.resource_type === "video" ? "video" : "image";
  const originalFilename =
    (file && typeof file.name === "string" ? file.name : null) ||
    (typeof result.original_filename === "string" ? result.original_filename : null);
  let thumbnail = result.secure_url;
  if (resourceType === "video") {
    thumbnail =
      result.thumbnail_url ||
      buildVideoThumbnailUrl(cloudName, result.public_id) ||
      VIDEO_THUMB_FALLBACK;
  }
  return {
    url: result.secure_url,
    type: resourceType,
    thumbnail,
    cloudinaryId: result.public_id,
    cloudinaryResourceType: resourceType,
    originalFilename: originalFilename || undefined,
  };
}

function uploadFileToCloudinaryUnsigned(file, config, onProgress) {
  return new Promise((resolve, reject) => {
    const endpoint = `https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`;
    const fd = new FormData();
    fd.append("upload_preset", config.uploadPreset);
    if (config.folder) fd.append("folder", config.folder);
    fd.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.responseType = "json";

    if (xhr.upload && typeof onProgress === "function") {
      xhr.upload.addEventListener("progress", (evt) => {
        if (evt.lengthComputable) {
          onProgress((evt.loaded / evt.total) * 100);
        }
      });
    }

    xhr.onload = () => {
      const response = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const media = makeMediaPayloadFromUpload({
            result: response,
            file,
            cloudName: config.cloudName,
          });
          resolve(media);
        } catch (err) {
          reject(err);
        }
      } else {
        const message =
          response?.error?.message ||
          response?.message ||
          `Cloudinary upload failed (${xhr.status})`;
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during Cloudinary upload."));
    xhr.send(fd);
  });
}

function normalizeCategory(value) {
  const str = typeof value === "string" ? value.trim() : "";
  if (!str) return DEFAULT_PROJECT_CATEGORY;
  const clean = str.replace(/\s+/g, " ");
  if (clean === clean.toUpperCase()) return clean;
  return clean
    .split(" ")
    .map((word) => {
      if (!word) return "";
      if (word === word.toUpperCase()) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function getProjectOrderValue(project) {
  if (Number.isFinite(project?.order)) return project.order;
  return null;
}

function getProjectOriginalIndex(project, fallbackIndex = 0) {
  if (Number.isFinite(project?.__idx)) return project.__idx;
  return fallbackIndex;
}

function getProjectRecencyWeight(project, fallback = 0) {
  if (!project || typeof project !== "object") return fallback;
  const created = Date.parse(project.createdAt);
  if (Number.isFinite(created)) return created;
  const updated = Date.parse(project.updatedAt);
  if (Number.isFinite(updated)) return updated;
  return fallback;
}

function compareProjectsForDisplay(a, b, fallbackA = 0, fallbackB = 0) {
  const orderA = getProjectOrderValue(a);
  const orderB = getProjectOrderValue(b);
  if (orderA !== null || orderB !== null) {
    if (orderA === null) return 1;
    if (orderB === null) return -1;
    if (orderA !== orderB) return orderA - orderB;
  }
  const recencyDiff =
    getProjectRecencyWeight(b, fallbackB) - getProjectRecencyWeight(a, fallbackA);
  if (recencyDiff !== 0) return recencyDiff;
  return getProjectOriginalIndex(a, fallbackA) - getProjectOriginalIndex(b, fallbackB);
}

function sortProjectsForDisplay(projects = []) {
  if (!Array.isArray(projects)) return [];
  const total = projects.length;
  return projects
    .map((proj, idx) => ({ proj, fallback: total - idx }))
    .sort((a, b) => compareProjectsForDisplay(a.proj, b.proj, a.fallback, b.fallback))
    .map((entry) => entry.proj);
}

function getProjectSnippet(text, maxLength = 120) {
  const clean =
    typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!clean) return "";
  return clean.length > maxLength
    ? `${clean.slice(0, maxLength - 1)}…`
    : clean;
}

function getFilteredProjects() {
  const projects = window.publicProjectsCache || [];
  const filter = (window.publicProjectsFilter || "All").toLowerCase();
  if (filter === "all") return projects;
  return projects.filter(
    (p) => (p.category || DEFAULT_PROJECT_CATEGORY).toLowerCase() === filter,
  );
}

function buildProjectFilters(projects = []) {
  const container = document.getElementById("projectFilters");
  if (!container) return;
  const active = window.publicProjectsFilter || "All";
  const categorySet = new Set();
  projects.forEach((p) =>
    categorySet.add(p.category || DEFAULT_PROJECT_CATEGORY),
  );

  container.innerHTML = "";
  if (categorySet.size === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";
  const categories = ["All", ...Array.from(categorySet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )];
  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-chip" + (cat === active ? " active" : "");
    btn.dataset.cat = cat;
    btn.textContent = cat;
    btn.addEventListener("click", () => setProjectFilter(cat));
    container.appendChild(btn);
  });
}

function setProjectFilter(category) {
  const target = category || "All";
  window.publicProjectsFilter = target;
  window.publicProjectsCurrentPage = 1;
  buildProjectFilters(window.publicProjectsCache || []);
  renderPublicProjectsPage(1);
}

function parseTagsInput(value) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean)
      .filter((tag, index, arr) => arr.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index)
      .slice(0, 8);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[,;]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, arr) => arr.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index)
    .slice(0, 8);
}

function showProjectsSkeleton(grid) {
  if (!grid || grid.dataset.loading === "1") return;
  grid.dataset.loading = "1";
  const count = window.matchMedia("(min-width: 900px)").matches ? 6 : 4;
  const skeletonCard = `
    <div class="project-card-skeleton" aria-hidden="true">
      <div class="project-card-skeleton__media"></div>
      <div class="project-card-skeleton__body">
        <span class="skeleton-line skeleton-line--lg"></span>
        <span class="skeleton-line skeleton-line--md"></span>
        <span class="skeleton-line skeleton-line--sm"></span>
      </div>
    </div>
  `;
  grid.innerHTML = new Array(count).fill(skeletonCard).join("");
}

function clearProjectsSkeleton(grid) {
  if (!grid) return;
  if (grid.dataset.loading === "1") {
    delete grid.dataset.loading;
  }
}

function preloadProjectMedia(projects, maxProjects = 4) {
  if (!Array.isArray(projects) || !projects.length) return;
  const slice = projects.slice(0, Math.max(0, maxProjects));
  slice.forEach((project) => {
    const mediaItems = Array.isArray(project?.media) ? project.media : [];
    mediaItems.slice(0, 3).forEach((media) => {
      if (!media) return;
      const baseSrc = (media.url || media.thumbnail || "").trim();
      let candidate = baseSrc;
      if (media.type === "video") {
        candidate = media.thumbnail || baseSrc;
      } else {
        candidate = optimizeMediaUrl(baseSrc, "detail");
      }
      if (!candidate || prefetchedAssets.has(candidate)) return;
      prefetchedAssets.add(candidate);
      if (typeof Image === "function") {
        const img = new Image();
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.src = candidate;
      }
    });
  });
}

function preloadAdjacentProjectMedia(centerIndex) {
  const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
  if (!projects.length) return;
  const neighbors = [];
  if (projects[centerIndex + 1]) neighbors.push(projects[centerIndex + 1]);
  if (projects[centerIndex - 1]) neighbors.push(projects[centerIndex - 1]);
  preloadProjectMedia(neighbors, neighbors.length);
}

function initProjectCardObserver() {
  if (projectCardObserver) return;
  if (typeof IntersectionObserver !== "function") {
    projectCardObserver = {
      observe: (element) => {
        if (element && element.classList) element.classList.add("visible");
      },
      unobserve: () => {},
      disconnect: () => {},
    };
    return;
  }
  projectCardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          projectCardObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -10%" },
  );
}

function applyProjectCardObserver(container) {
  if (!container) return;
  initProjectCardObserver();
  container.querySelectorAll(".project-card").forEach((card, idx) => {
    card.classList.remove("visible");
    card.style.setProperty("--card-delay", `${Math.min(idx, 6) * 0.07}s`);
    projectCardObserver.observe(card);
  });
  if (typeof IntersectionObserver === "function") {
    setTimeout(() => {
      container.querySelectorAll(".project-card").forEach((card) => {
        if (!card.classList.contains("visible")) {
          card.classList.add("visible");
        }
      });
    }, 800);
  }
}

function initSectionObserver() {
  if (sectionObserver) return;
  if (typeof IntersectionObserver !== "function") {
    sectionObserver = null;
    return;
  }
  sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('section-visible');
        sectionObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });
}

function applySectionObserver() {
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    document.querySelectorAll(".reveal-section").forEach((section) => {
      section.classList.add("section-visible");
    });
    return;
  }
  if (typeof IntersectionObserver !== "function") {
    document.querySelectorAll('.reveal-section').forEach((section) => {
      section.classList.add('section-visible');
    });
    return;
  }
  initSectionObserver();
  document.querySelectorAll('.reveal-section').forEach((section) => {
    if (!sectionObserver) return;
    section.classList.remove('section-visible');
    sectionObserver.observe(section);
  });
}

function initFeaturedMediaObserver() {
  if (featuredMediaObserver || typeof IntersectionObserver !== "function") return;
  featuredMediaObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (!(video instanceof HTMLVideoElement)) return;
        if (entry.isIntersecting) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise
              .then(() => video.classList.add("is-playing"))
              .catch(() => {});
          } else {
            video.classList.add("is-playing");
          }
        } else {
          video.classList.remove("is-playing");
          video.pause();
          try {
            video.currentTime = 0;
          } catch {
            /* ignore */
          }
        }
      });
    },
    { threshold: 0.55 },
  );
}

function applyFeaturedMediaObserver(container) {
  if (!container || typeof IntersectionObserver !== "function") return;
  initFeaturedMediaObserver();
  if (!featuredMediaObserver) return;
  featuredMediaObserver.disconnect();
  container.querySelectorAll("video[data-autoplay]").forEach((video) => {
    video.classList.remove("is-playing");
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      /* ignore */
    }
    featuredMediaObserver.observe(video);
  });
}

function initHeroParallax() {
  if (heroParallaxInitialized || typeof window === "undefined") return;
  const hero = document.querySelector(".hero");
  if (!hero) return;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointerFine = window.matchMedia("(pointer: fine)").matches;
  if (prefersReducedMotion || !pointerFine) return;

  const parallaxTargets = hero.querySelectorAll("[data-depth]");
  if (!parallaxTargets.length) return;

  heroParallaxInitialized = true;
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;

  const animate = () => {
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;
    parallaxTargets.forEach((node) => {
      const depth = Number.parseFloat(node.dataset.depth || "0");
      if (!Number.isFinite(depth)) return;
      const translateX = (currentX * depth * 28).toFixed(2);
      const translateY = (currentY * depth * 20).toFixed(2);
      node.style.transform = `translate3d(${translateX}px, ${translateY}px, 0)`;
    });
    heroParallaxFrame = requestAnimationFrame(animate);
  };

  const updatePointer = (event) => {
    const rect = hero.getBoundingClientRect();
    targetX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    targetY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  };

  const resetPointer = () => {
    targetX = 0;
    targetY = 0;
  };

  hero.addEventListener("pointermove", updatePointer);
  hero.addEventListener("pointerenter", updatePointer);
  hero.addEventListener("pointerleave", resetPointer);
  window.addEventListener("blur", resetPointer);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetPointer();
  });

  animate();
}

function setupHeroBlend() {
  if (heroBlendObserver || typeof IntersectionObserver !== "function") return;
  const projectsSection = document.getElementById("projects");
  if (!projectsSection) return;
  heroBlendObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        document.body.classList.toggle("body--projects-visible", entry.isIntersecting);
      });
    },
    { threshold: 0.25 },
  );
  heroBlendObserver.observe(projectsSection);
}

async function fetchHeroVideo(force = false) {
  const now = Date.now();
  if (!force && heroVideoCache && now - heroVideoCacheTime < HERO_VIDEO_CACHE_TTL) {
    return heroVideoCache;
  }
  try {
    const res = await fetch("/api/config/hero-video", { cache: "no-store" });
    const { data, text } = await readResponsePayload(res);
    if (!res.ok) {
      throw new Error(pickResponseErrorMessage(data, text, `Hero config request failed (${res.status})`));
    }
    heroVideoCache = data?.heroVideo || null;
    heroVideoCacheTime = Date.now();
    return heroVideoCache;
  } catch (err) {
    console.warn("Hero video fetch failed:", err?.message || err);
    heroVideoCache = null;
    heroVideoCacheTime = Date.now();
    return null;
  }
}

async function loadHeroAmbientVideo({ force = false, payload } = {}) {
  const shell = document.querySelector("[data-hero-video]");
  if (!shell) return null;
  const video = shell.querySelector("video");
  if (!video) return null;
  const mobilePositionFallback = shell.getAttribute("data-mobile-position") || "";
  let heroVideo = payload;
  if (!heroVideo) {
    heroVideo = await fetchHeroVideo(force);
  }
  if (!heroVideo?.url) {
    shell.classList.add("hero-video--empty");
    shell.classList.remove("hero-video--loading");
    if (video.getAttribute("src")) {
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
    }
    clearHeroVideoCssVars(video);
    applyHeroOverlaySettings(null);
    return null;
  }
  shell.classList.remove("hero-video--empty");
  shell.classList.add("hero-video--loading");
  if (heroVideo.thumbnail) {
    video.poster = heroVideo.thumbnail;
  }
  if (video.getAttribute("src") !== heroVideo.url) {
    video.src = heroVideo.url;
    try {
      video.load();
    } catch {
      /* noop */
    }
  }
  const handleHeroReady = () => {
    shell.classList.remove("hero-video--loading");
  };
  if (video.readyState >= 2) {
    handleHeroReady();
  } else {
    video.addEventListener("loadeddata", handleHeroReady, { once: true });
    video.addEventListener("canplay", handleHeroReady, { once: true });
  }
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "true");
  applyHeroVideoCssVars(video, heroVideo, { mobilePosition: mobilePositionFallback });
  applyHeroOverlaySettings(heroVideo);
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
  return heroVideo;
}

function initCtaBanner() {
  const banner = document.getElementById('ctaBanner');
  if (!banner || banner.dataset.bound === "1") return;

  let dismissed = false;
  try {
    dismissed = window.sessionStorage?.getItem("ctaBannerDismissed") === "1";
  } catch {
    dismissed = false;
  }
  if (dismissed) {
    banner.style.display = "none";
    return;
  }

  const closeBtn = banner.querySelector('.cta-banner__close');
  closeBtn?.addEventListener('click', () => {
    banner.classList.add('cta-banner--hidden');
    try {
      window.sessionStorage?.setItem("ctaBannerDismissed", "1");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      banner.style.display = 'none';
    }, 320);
  });

  banner.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-scroll-target]");
    if (!trigger) return;
    const selector = trigger.getAttribute("data-scroll-target");
    if (!selector) return;
    event.preventDefault();
    const target = document.querySelector(selector);
    if (target?.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth" });
    } else {
      window.location.hash = selector;
    }
  });

  const contactSection = document.getElementById("contact");
  if (contactSection && typeof IntersectionObserver === "function") {
    if (ctaContactObserver) {
      ctaContactObserver.disconnect();
    }
    ctaContactObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          banner.classList.toggle("cta-banner--muted", entry.isIntersecting);
        });
      },
      { threshold: 0.35 },
    );
    ctaContactObserver.observe(contactSection);
  }

  banner.dataset.bound = "1";
}

async function loadPublicProjects(page) {
  const grid = document.getElementById("projectsGrid");
  if (!grid) return;

  if (Array.isArray(window.publicFeaturedProjects)) {
    window.publicFeaturedProjects.length = 0;
  } else {
    window.publicFeaturedProjects = [];
  }
  renderFeaturedProjectsSection();

  showProjectsSkeleton(grid);

  const currentPage =
    typeof window !== "undefined" && Number.isFinite(Number(window.publicProjectsCurrentPage))
      ? Number(window.publicProjectsCurrentPage)
      : 1;
  const requestedPage =
    Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : currentPage;

  try {
    const res = await fetch("/api/projects");
    const { data, text } = await readResponsePayload(res);
    if (!res.ok) {
      throw new Error(pickResponseErrorMessage(data, text, "Failed to fetch projects"));
    }
    if (!Array.isArray(data)) {
      throw new Error("Server returned an invalid project list.");
    }
    const rawProjects = data;
    const enriched = [...rawProjects]
      .map((project, idx) => {
        const normalized = {
          ...project,
          media: Array.isArray(project.media) ? project.media : [],
          __idx: idx,
        };
        normalized.category = normalizeCategory(normalized.category);
        normalized.description =
          typeof normalized.description === "string"
            ? normalized.description
            : "";
        normalized.client =
          typeof project.client === "string" ? project.client.trim() : "";
        normalized.status =
          (project.status || "published").toString().toLowerCase() === "draft"
            ? "draft"
            : "published";
        normalized.tags = parseTagsInput(project.tags || []);
        normalized.featured = normalized.status === "published" && Boolean(project.featured);
        return normalized;
      });

    const visibleProjects = enriched.filter((proj) => (proj.status || "published") !== "draft");
    const prioritized = sortProjectsForDisplay(visibleProjects);

    prioritized.forEach((p, displayIndex) => {
      p.status = (p.status || "published") === "draft" ? "draft" : "published";
      p.__displayIndex = displayIndex;
    });

    window.publicProjectsCache = prioritized;
    window.publicFeaturedProjects = prioritized.filter((proj) => proj.featured);
    if (typeof window.publicProjectsFilter !== "string") {
      window.publicProjectsFilter = "All";
    }

    if (window.publicProjectsFilter !== "All") {
      const hasActive = prioritized.some(
        (proj) =>
          (proj.category || DEFAULT_PROJECT_CATEGORY).toLowerCase() ===
          window.publicProjectsFilter.toLowerCase(),
      );
      if (!hasActive) {
        window.publicProjectsFilter = "All";
      }
    }

    buildProjectFilters(prioritized);
    preloadProjectMedia(prioritized, 6);
    renderFeaturedProjectsSection();

    const filteredCount = getFilteredProjects().length || 0;
    const totalPages = Math.max(1, Math.ceil(filteredCount / PROJECTS_PER_PAGE));
    const safePage = Math.min(Math.max(requestedPage, 1), totalPages);
    window.publicProjectsCurrentPage = safePage;
    renderPublicProjectsPage(safePage);
    clearProjectsSkeleton(grid);
  } catch (err) {
    console.error("Failed to load projects:", err);
    clearProjectsSkeleton(grid);
    grid.innerHTML = '<div class="projects-empty-state">Unable to load projects right now.</div>';
  }
}

function paginateProjects(page = 1) {
  const projects = getFilteredProjects();
  const totalPages = Math.max(1, Math.ceil(projects.length / PROJECTS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * PROJECTS_PER_PAGE;
  return {
    items: projects.slice(start, start + PROJECTS_PER_PAGE),
    totalPages,
    currentPage: safePage,
    offset: start,
  };
}

function renderPublicProjectsPage(page = 1) {
  const grid = document.getElementById("projectsGrid");
  if (!grid) return;
  clearProjectsSkeleton(grid);
  const pagination = document.getElementById("projectsPagination");
  const { items, totalPages, currentPage, offset } = paginateProjects(page);
  window.publicProjectsCurrentPage = currentPage;

  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = '<div class="projects-empty-state">No projects to show yet.</div>';
    renderProjectsPagination(pagination, totalPages, currentPage);
    return;
  }
  items.forEach((p, idx) => {
    const mediaItems = Array.isArray(p.media) ? p.media : [];
    if (!mediaItems.length) return;

      const firstMedia = mediaItems[0];
      const category = p.category || DEFAULT_PROJECT_CATEGORY;
      const snippetText = getProjectSnippet(p.description || "");
      const displayIndex =
        typeof p.__displayIndex === "number" ? p.__displayIndex : offset + idx;
      const sourceIndex = typeof p.__idx === "number" ? p.__idx : displayIndex;
      const delay = Math.min(idx, 6) * 0.07;
      const heroOverride = findHeroMediaCandidate(mediaItems, p.heroMediaUrl);
      const heroMedia = heroOverride || firstMedia;
      if (!heroMedia) return;

      const heroThumb = getMediaThumbWithVariant(heroMedia, "hero");
      const titleText = escapeHtml(p.title || "Untitled Project");
      const categoryText = escapeHtml(category);
      const clientName =
        typeof p.client === "string" ? p.client.trim() : "";
      const clientHtml = clientName
        ? `<p class="project-card-client">Client: ${escapeHtml(clientName)}</p>`
        : "";
      const snippetHtml = snippetText ? `<p class="project-card-desc">${escapeHtml(snippetText)}</p>` : "";
      const shareButtonDefault = buildShareButton(displayIndex);
      const altText = escapeHtml(`${p.title || "Project"} showcase`);
      const heroMediaIndex = mediaItems.indexOf(heroMedia);
      const safeMediaIndex = heroMediaIndex >= 0 ? heroMediaIndex : 0;
      const shareId = buildProjectShareId(p, sourceIndex);
      const detailPath = `/p/${shareId}`;
      const mediaCountText = formatMediaCount(mediaItems);
      const focusAttr = buildMediaFocusAttr(heroMedia);
      const imageAttrs = 'loading="lazy" decoding="async" fetchpriority="auto"';

    let mediaTag = "";
    if (heroMedia.type === "video") {
      mediaTag = `
        <div class="video-thumb">
          <img src="${heroThumb}" alt="${altText}" loading="lazy" decoding="async"${focusAttr}>
          <span class="play-icon" aria-hidden="true">&#9658;</span>
        </div>
      `;
    } else {
      mediaTag = `<img src="${heroThumb}" alt="${altText}" ${imageAttrs}${focusAttr}>`;
    }

    const cardClass = "project-card";
    grid.insertAdjacentHTML(
      "beforeend",
      `
      <article class="${cardClass}" id="project-${displayIndex}" data-index="${sourceIndex}" data-display-index="${displayIndex}" data-media-index="${safeMediaIndex}" style="--card-delay:${delay}s">
        <a class="project-card-link" href="${detailPath}" aria-label="View ${titleText}">
          <div class="project-card-media">
            ${mediaTag}
          </div>
          <div class="project-card-meta">
            <span class="project-card-category">${categoryText}</span>
            <h3>${titleText}</h3>
            ${clientHtml}
            ${snippetHtml}
          </div>
        </a>
        <div class="project-card-actions">
          <span class="project-card-count">${mediaCountText}</span>
          ${shareButtonDefault}
        </div>
      </article>
    `
    );
  });

  attachFallbacks(grid);
  applyProjectCardObserver(grid);
  applyFeaturedMediaObserver(grid);
  preloadProjectMedia(items, 4);

  renderProjectsPagination(pagination, totalPages, currentPage);
  openProjectFromHash();
}

function renderProjectsPagination(container, totalPages, currentPage) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";

  const maxButtons = 5;
  let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let end = start + maxButtons - 1;
  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - maxButtons + 1);
  }

  const buttons = [];
  const addButton = (label, target, disabled = false, active = false) => {
    const classes = ["pagination-btn"];
    if (disabled) classes.push("disabled");
    if (active) classes.push("active");
    buttons.push(
      `<button class="${classes.join(" ")}" ${
        disabled ? "disabled" : `onclick="changeProjectsPage(${target})"`
      }>${label}</button>`
    );
  };

  addButton("Prev", currentPage - 1, currentPage === 1);
  if (start > 1) {
    addButton("1", 1, false, currentPage === 1);
    if (start > 2) buttons.push(`<span class="pagination-ellipsis">…</span>`);
  }
  for (let i = start; i <= end; i += 1) {
    addButton(String(i), i, false, i === currentPage);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) buttons.push(`<span class="pagination-ellipsis">…</span>`);
    addButton(String(totalPages), totalPages, false, currentPage === totalPages);
  }
  addButton("Next", currentPage + 1, currentPage === totalPages);

  container.innerHTML = buttons.join("");
}

function openProjectFromHash() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash || "";

  if (hash.startsWith("#share-")) {
    const shareId = hash.slice("#share-".length).trim();
    if (!shareId) return;
    const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
    for (let i = 0; i < projects.length; i += 1) {
      const project = projects[i];
      const sourceIndex = Number.isInteger(project?.__idx) ? project.__idx : i;
      const candidateId = buildProjectShareId(project, sourceIndex);
      if (candidateId === shareId) {
        const displayIndex = Number.isInteger(project?.__displayIndex)
          ? project.__displayIndex
          : i;
        const card = document.getElementById(`project-${displayIndex}`);
        if (!card) return;
        const mediaIndex =
          Number.parseInt(card.getAttribute("data-media-index") || "0", 10) || 0;
        window.location.replace(`/p/${shareId}`);
        return;
      }
    }
    return;
  }

  if (!hash.startsWith("#project-")) return;
  const raw = hash.replace("#project-", "");
  const numericIndex = Number.parseInt(raw, 10);
  if (!Number.isFinite(numericIndex)) return;

  let targetDisplayIndex = numericIndex;
  let card = document.getElementById(`project-${targetDisplayIndex}`);

  if (!card) {
    const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
    const project = projects.find(
      (entry) => Number.isInteger(entry?.__idx) && entry.__idx === numericIndex,
    );
    if (!project) return;
    targetDisplayIndex = Number.isInteger(project.__displayIndex)
      ? project.__displayIndex
      : projects.indexOf(project);
    card = document.getElementById(`project-${targetDisplayIndex}`);
    if (!card) return;
  }

  const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
  const project = projects.find((entry) => {
    if (!entry) return false;
    if (Number.isInteger(entry.__displayIndex) && entry.__displayIndex === targetDisplayIndex) {
      return true;
    }
    return Number.isInteger(entry.__idx) && entry.__idx === numericIndex;
  });
  if (!project) return;
  const sourceIndex = Number.isInteger(project.__idx)
    ? project.__idx
    : projects.indexOf(project);
  if (!Number.isInteger(sourceIndex)) return;
  const shareId = buildProjectShareId(project, sourceIndex);
  window.location.replace(`/p/${shareId}`);
}

async function shareProject(event, projectIndex) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
  let project = projects[projectIndex];
  if (!project) {
    project = projects.find((p) =>
      Number.isInteger(p?.__displayIndex) ? p.__displayIndex === projectIndex : false,
    );
  }
  if (!project) return;

  const origin =
    window.location?.origin ||
    `${window.location?.protocol || ""}//${window.location?.host || ""}`;
  const sourceIndex = Number.isInteger(project.__idx) ? project.__idx : projectIndex;
  const shareId = buildProjectShareId(project, sourceIndex);
  const sharePath = `/p/${shareId}`;
  const shareUrl = origin ? `${origin}${sharePath}` : sharePath;
  const title = project.title ? String(project.title).trim() : "Movil Project";
  const category = project.category ? ` (${project.category})` : "";

  const baseText = `Check out "${title}"${category} from Movil.`;
  const shareData = {
    title,
    text: baseText,
    url: shareUrl,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.warn("Share API failed, falling back to clipboard.", err);
    }
  }

  const copyToClipboard = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied to clipboard!");
      return true;
    }
    return false;
  };

  try {
    const copied = await copyToClipboard();
    if (!copied) {
      const tempInput = document.createElement("input");
      tempInput.value = shareUrl;
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand("copy");
      document.body.removeChild(tempInput);
      alert("Link copied to clipboard!");
    }
  } catch (err) {
    console.error("Clipboard copy failed", err);
    alert(`Share this link:\n${shareUrl}`);
  }
}

window.shareProject = shareProject;

function formatMediaCount(mediaItems) {
  if (!Array.isArray(mediaItems) || !mediaItems.length) return "No media";
  const totals = mediaItems.reduce(
    (acc, item) => {
      if (!item) return acc;
      if ((item.type || "").toLowerCase() === "video") acc.videos += 1;
      else acc.images += 1;
      return acc;
    },
    { images: 0, videos: 0 },
  );
  const parts = [];
  if (totals.images) parts.push(`${totals.images} photo${totals.images > 1 ? "s" : ""}`);
  if (totals.videos) parts.push(`${totals.videos} video${totals.videos > 1 ? "s" : ""}`);
  return parts.join(" • ");
}

function buildShareButton(displayIndex, extraClass = "") {
  const classes = ["project-card-share"];
  if (extraClass) classes.push(extraClass);
  return `
    <button type="button"
      class="${classes.join(" ")}"
      onclick="shareProject(event, ${displayIndex})"
      aria-label="Share project ${displayIndex}">
      <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
      <span>Share</span>
    </button>
  `;
}

function changeProjectsPage(page) {
  renderPublicProjectsPage(page);
}

window.changeProjectsPage = changeProjectsPage;

function renderFeaturedProjectsSection() {
  const section = $id("featuredProjects");
  const track = $id("featuredCarouselTrack");
  const dotsRoot = $id("featuredCarouselDots");
  const viewport = $id("featuredCarouselViewport");
  if (!section || !track || !dotsRoot || !viewport) return;
  const projects = (window.publicFeaturedProjects || []).slice(0, FEATURED_PROJECTS_LIMIT);
  if (!projects.length) {
    section.hidden = true;
    track.innerHTML = "";
    dotsRoot.innerHTML = "";
    stopFeaturedAutoplay();
    featuredCarouselState.total = 0;
    return;
  }
  section.hidden = false;
  track.innerHTML = projects.map(buildFeaturedProjectCard).join("");
  dotsRoot.innerHTML = projects
    .map(
      (_, idx) =>
        `<button type="button" class="featured-dot" data-featured-dot="${idx}" aria-label="Go to featured project ${idx + 1}"></button>`,
    )
    .join("");
  featuredCarouselState.total = projects.length;
  setFeaturedSlide(0);
  initFeaturedCarouselNav();
  updateFeaturedNavState();
  if (projects.length > 1) {
    startFeaturedAutoplay();
  } else {
    stopFeaturedAutoplay();
  }
}

function buildFeaturedProjectCard(project, index = 0) {
  if (!project) return "";
  const mediaItems = Array.isArray(project.media) ? project.media : [];
  const heroMedia = findHeroMediaCandidate(mediaItems, project.heroMediaUrl) || mediaItems[0];
  if (!heroMedia) return "";
  const heroThumb = getMediaThumbWithVariant(heroMedia, "detail");
  const titleText = escapeHtml(project.title || "Featured project");
  const categoryText = escapeHtml(project.category || DEFAULT_PROJECT_CATEGORY);
  const snippet = getProjectSnippet(project.description || "", 140);
  const snippetHtml = snippet ? `<p>${escapeHtml(snippet)}</p>` : "";
  const shareId = buildProjectShareId(project, project.__idx ?? index);
  const detailPath = `/p/${shareId}`;
  const altText = escapeHtml(`${project.title || "Project"} preview`);
  const focusAttr = buildMediaFocusAttr(heroMedia);
  return `
    <div class="featured-slide" data-featured-slide="${index}">
      <article class="featured-card">
        <div class="featured-card-media">
          <img src="${heroThumb}" alt="${altText}" loading="lazy" decoding="async"${focusAttr}>
        </div>
        <div class="featured-card-body">
          <span class="featured-card-category">${categoryText}</span>
          <h3>${titleText}</h3>
          ${snippetHtml}
          <a class="featured-card-link" href="${detailPath}">
            View Project
            <span aria-hidden="true">&#10140;</span>
          </a>
        </div>
      </article>
    </div>
  `;
}

function setFeaturedSlide(targetIndex) {
  const track = $id("featuredCarouselTrack");
  if (!track) return;
  const slides = track.querySelectorAll(".featured-slide");
  if (!slides.length) return;
  const total = slides.length;
  const normalized = ((targetIndex % total) + total) % total;
  featuredCarouselState.index = normalized;
  track.style.transform = `translateX(-${normalized * 100}%)`;
  const dotsRoot = $id("featuredCarouselDots");
  const dots = dotsRoot ? dotsRoot.querySelectorAll(".featured-dot") : [];
  dots.forEach((dot, idx) => {
    dot.classList.toggle("is-active", idx === normalized);
  });
  updateFeaturedNavState();
}

function nextFeaturedSlide() {
  setFeaturedSlide(featuredCarouselState.index + 1);
}

function prevFeaturedSlide() {
  setFeaturedSlide(featuredCarouselState.index - 1);
}

function startFeaturedAutoplay() {
  stopFeaturedAutoplay();
  if (featuredCarouselState.total <= 1) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  featuredCarouselState.timer = setInterval(nextFeaturedSlide, FEATURED_AUTOPLAY_INTERVAL);
}

function stopFeaturedAutoplay() {
  if (featuredCarouselState.timer) {
    clearInterval(featuredCarouselState.timer);
    featuredCarouselState.timer = null;
  }
}

function initFeaturedCarouselNav() {
  if (typeof window === "undefined") return;
  const carousel = $id("featuredCarousel");
  if (carousel?.dataset.bound === "1") return;
  if (carousel) carousel.dataset.bound = "1";
  const prevBtn = document.querySelector("[data-featured-prev]");
  const nextBtn = document.querySelector("[data-featured-next]");
  prevBtn?.addEventListener("click", () => {
    prevFeaturedSlide();
    startFeaturedAutoplay();
  });
  nextBtn?.addEventListener("click", () => {
    nextFeaturedSlide();
    startFeaturedAutoplay();
  });
  const dotsRoot = $id("featuredCarouselDots");
  dotsRoot?.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-featured-dot]");
    if (!dot) return;
    const idx = Number(dot.dataset.featuredDot);
    if (!Number.isFinite(idx)) return;
    setFeaturedSlide(idx);
    startFeaturedAutoplay();
  });
  const viewport = $id("featuredCarouselViewport");
  if (viewport && !viewport.dataset.bindSwipe) {
    viewport.dataset.bindSwipe = "1";
    let startX = 0;
    let deltaX = 0;
    let isDown = false;
    const threshold = 40;
    const onPointerDown = (event) => {
      isDown = true;
      deltaX = 0;
      startX = event.clientX || 0;
      stopFeaturedAutoplay();
    };
    const onPointerMove = (event) => {
      if (!isDown) return;
      deltaX = (event.clientX || 0) - startX;
    };
    const onPointerUp = () => {
      if (!isDown) return;
      isDown = false;
      if (Math.abs(deltaX) > threshold) {
        if (deltaX < 0) nextFeaturedSlide();
        else prevFeaturedSlide();
      }
      startFeaturedAutoplay();
    };
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointerleave", onPointerUp);
    viewport.addEventListener("mouseenter", stopFeaturedAutoplay);
    viewport.addEventListener("mouseleave", () => {
      if (featuredCarouselState.total > 1) {
        startFeaturedAutoplay();
      }
    });
  }
}

function updateFeaturedNavState() {
  const prevBtn = document.querySelector("[data-featured-prev]");
  const nextBtn = document.querySelector("[data-featured-next]");
  const disabled = featuredCarouselState.total <= 1;
  if (prevBtn) prevBtn.disabled = disabled;
  if (nextBtn) nextBtn.disabled = disabled;
}
/************ MODAL (for public view) ************/
/************ MODAL (for public view) ************/
let currentProjectIndex = 0;
let currentMediaIndex = 0;
const MODAL_SWIPE_THRESHOLD = 42;
let modalTouchStartX = null;
let modalTouchStartY = null;
let modalTouchActive = false;
let modalKeydownAttached = false;
let bodyScrollLocked = false;
let previousBodyPaddingRight = "";
let scrollLockY = 0;

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const docEl = document.documentElement;
  if (!body || bodyScrollLocked) return;
  scrollLockY =
    (typeof window !== "undefined" ? window.scrollY : 0) ||
    (docEl ? docEl.scrollTop : 0) ||
    0;
  body.dataset.modalScrollLock = String(scrollLockY);
  previousBodyPaddingRight = body.style.paddingRight || "";
  const scrollbarWidth =
    typeof window !== "undefined" && docEl
      ? window.innerWidth - docEl.clientWidth
      : 0;
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }
  body.style.overflow = "hidden";
  body.classList.add("modal-open");
  if (docEl) {
    docEl.style.overflow = "hidden";
    docEl.classList.add("modal-open");
  }
  bodyScrollLocked = true;
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const docEl = document.documentElement;
  if (!body || !bodyScrollLocked) return;
  const stored =
    typeof body.dataset.modalScrollLock === "string"
      ? Number(body.dataset.modalScrollLock) || 0
      : scrollLockY || 0;
  body.classList.remove("modal-open");
  if (docEl) {
    docEl.classList.remove("modal-open");
  }
  if (docEl) {
    docEl.style.overflow = "";
  }
  body.style.overflow = "";
  body.style.paddingRight = previousBodyPaddingRight;
  previousBodyPaddingRight = "";
  if (typeof body.dataset.modalScrollLock !== "undefined") {
    delete body.dataset.modalScrollLock;
  }
  if (typeof window !== "undefined") {
    window.scrollTo(0, stored);
  }
  bodyScrollLocked = false;
  scrollLockY = 0;
}

function openModal(projectIndex, mediaIndex, options = {}) {
  currentProjectIndex = projectIndex;
  currentMediaIndex = mediaIndex;
  const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
  if (projects[currentProjectIndex]) {
    preloadProjectMedia([projects[currentProjectIndex]], 1);
  }
  preloadAdjacentProjectMedia(currentProjectIndex);
  renderModal();

  const modal = document.getElementById("projectModal");
  lockBodyScroll();
  modal.style.display = "flex"; // make it visible first
  requestAnimationFrame(() => modal.classList.add("show")); // trigger fade-in

  if (typeof window !== "undefined") {
    if (options.preserveHash) {
      if (options.shareId) {
        const targetHash = `#share-${options.shareId}`;
        const baseUrl = `${window.location.pathname}${window.location.search}`;
        if (window.location.hash !== targetHash) {
          if (window.history?.replaceState) {
            window.history.replaceState(null, "", `${baseUrl}${targetHash}`);
          } else {
            window.location.hash = targetHash.slice(1);
          }
        }
      }
    } else if (window.history?.replaceState) {
      const newUrl =
        `${window.location.pathname}${window.location.search}#project-${projectIndex}`;
      window.history.replaceState(null, "", newUrl);
    } else {
      window.location.hash = `project-${projectIndex}`;
    }
  }
}

function closeModal() {
  const modal = document.getElementById("projectModal");
  if (!modal) {
    unlockBodyScroll();
    return;
  }
  const activeVideo = modal.querySelector("#modalMedia video");
  if (activeVideo) {
    activeVideo.pause();
  }
  unlockBodyScroll();
  modal.classList.remove("show"); // trigger fade-out
  setTimeout(() => {
    modal.style.display = "none";
  }, 220); // keep in sync with CSS transition

  if (typeof window !== "undefined" && window.history?.replaceState) {
    const newUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", newUrl);
  } else if (typeof window !== "undefined") {
    window.location.hash = "";
  }
}


function nextMedia() {
  const p = window.publicProjectsCache[currentProjectIndex];
  currentMediaIndex = (currentMediaIndex + 1) % p.media.length;
  renderModal();
}

function prevMedia() {
  const p = window.publicProjectsCache[currentProjectIndex];
  currentMediaIndex =
    (currentMediaIndex - 1 + p.media.length) % p.media.length;
  renderModal();
}

function jumpToMedia(i) {
  currentMediaIndex = i;
  renderModal();
}

function renderModal() {
  const p = window.publicProjectsCache[currentProjectIndex];
  if (!p) return;

  const media = p.media[currentMediaIndex];
  const modalMedia = document.getElementById("modalMedia");
  if (!modalMedia) return;
  const poster = getMediaThumb(media);
  const rawMediaUrl = typeof media?.url === "string" ? media.url : "";
  const detailImageSrc = media.type === "image" ? optimizeMediaUrl(rawMediaUrl || poster, "detail") : rawMediaUrl;
  const fallbackImageSrc = poster || media?.thumbnail || rawMediaUrl || VIDEO_THUMB_FALLBACK;
  const safePoster = escapeHtml(poster || "");
  const safeImageSrc = escapeHtml(detailImageSrc || fallbackImageSrc);
  const safeFallbackImageSrc = escapeHtml(fallbackImageSrc || VIDEO_THUMB_FALLBACK);
  const safeVideoSrc = escapeHtml(rawMediaUrl || "");

  if (media.type === "image") {
    modalMedia.innerHTML = `
      <div class="modal-media-wrapper">
        <img src="${safeImageSrc}" data-fallback="${safeFallbackImageSrc}" alt="${escapeHtml(
          p.title || "Project media",
        )}" class="modal-img modal-media-el">
      </div>`;
  } else {
    modalMedia.innerHTML = `
      <div class="modal-media-wrapper">
        <video src="${safeVideoSrc}" poster="${safePoster}" controls muted playsinline preload="metadata" class="modal-video modal-media-el"></video>
      </div>`;
  }
  attachFallbacks(modalMedia);
  const modalImg = modalMedia.querySelector(".modal-img");
  if (modalImg) {
    modalImg.addEventListener("error", () => {
      const fallbackSrc = modalImg.getAttribute("data-fallback");
      if (fallbackSrc && modalImg.src !== fallbackSrc) {
        modalImg.src = fallbackSrc;
      } else if (modalImg.src !== VIDEO_THUMB_FALLBACK) {
        modalImg.src = VIDEO_THUMB_FALLBACK;
      }
    });
  }

  const titleEl = document.getElementById("modalTitle");
  if (titleEl) titleEl.innerText = p.title || "Untitled Project";

  const clientEl = document.getElementById("modalClient");
  if (clientEl) {
    const clientName = typeof p.client === "string" ? p.client.trim() : "";
    const hasClient = Boolean(clientName);
    if (hasClient) {
      clientEl.textContent = `Client: ${clientName}`;
      clientEl.style.display = "block";
    } else {
      clientEl.textContent = "";
      clientEl.style.display = "none";
    }
  }

  const descEl = document.getElementById("modalDesc");
  if (descEl) descEl.innerText = p.description || "";

  const thumbsHTML = (p.media || [])
    .map((m, i) => {
      const thumb = getMediaThumb(m);
      const thumbAlt = `${p.title || "Project"} preview ${i + 1}`;
      return `<img src="${thumb}" alt="${thumbAlt}" loading="lazy" class="thumb ${
        i === currentMediaIndex ? "active" : ""
      }" onclick="jumpToMedia(${i})">`;
    })
    .join("");
  const thumbsEl = document.getElementById("modalThumbnails");
  if (thumbsEl) {
    thumbsEl.innerHTML = thumbsHTML;
    attachFallbacks(thumbsEl);
  }
}
function isModalOpen() {
  const modal = document.getElementById("projectModal");
  return Boolean(modal && modal.classList.contains("show"));
}

function handleModalKeydown(event) {
  if (!isModalOpen()) return;
  if (event.key === "Escape") {
    closeModal();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nextMedia();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    prevMedia();
  }
}

function handleModalTouchStart(e) {
  if (!isModalOpen() || e.touches.length !== 1) return;
  if (e.target.closest(".modal-btn")) return;
  modalTouchActive = true;
  modalTouchStartX = e.touches[0].clientX;
  modalTouchStartY = e.touches[0].clientY;
}

function handleModalTouchMove(e) {
  if (!modalTouchActive || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - modalTouchStartX;
  const dy = e.touches[0].clientY - modalTouchStartY;
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > MODAL_SWIPE_THRESHOLD) {
    modalTouchActive = false;
  }
}

function handleModalTouchEnd(e) {
  if (!modalTouchActive || e.changedTouches.length !== 1) return;
  const dx = e.changedTouches[0].clientX - modalTouchStartX;
  const dy = e.changedTouches[0].clientY - modalTouchStartY;
  modalTouchActive = false;
  modalTouchStartX = null;
  modalTouchStartY = null;

  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > MODAL_SWIPE_THRESHOLD) {
    if (dx < 0) {
      nextMedia();
    } else {
      prevMedia();
    }
  }
}

function setupModalInteractions() {
  const modal = document.getElementById("projectModal");
  const swipeArea = document.getElementById("modalMediaWrapper");

  if (modal && !modal.dataset.enhanced) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
    modal.addEventListener("touchend", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
    modal.dataset.enhanced = "true";
  }

  if (swipeArea && !swipeArea.dataset.swipeEnabled) {
    swipeArea.addEventListener("touchstart", handleModalTouchStart, { passive: true });
    swipeArea.addEventListener("touchmove", handleModalTouchMove, { passive: true });
    swipeArea.addEventListener("touchend", handleModalTouchEnd);
    swipeArea.dataset.swipeEnabled = "true";
  }

  if (!modalKeydownAttached) {
    document.addEventListener("keydown", handleModalKeydown);
    modalKeydownAttached = true;
  }
}

/**************** GLOBAL ****************/
let currentEditIndex = null;
let removedMedia = []; // for deleted items
let currentHeroMediaUrl = "";
window.adminProjectsCache = [];
window.adminProjectsDisplay = [];
window.adminProjectsCurrentPage = 1;

const $ = (sel) => document.querySelector(sel);
const $id = (id) => document.getElementById(id);

function showAdminToast(message, type = "info") {
  const stack = $id("adminToastStack");
  if (!stack) {
    if (type === "error") {
      console.error(message);
    } else {
      console.log(message);
    }
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const title =
    type === "success" ? "Success" : type === "error" ? "Error" : "Notice";
  toast.innerHTML = `
    <span class="toast-title">${title}</span>
    <div class="toast-message">${message}</div>
  `;
  stack.appendChild(toast);
  const removeToast = () => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 320);
  };
  setTimeout(removeToast, 2800);
}

function setHeroVideoUploadProgress(value) {
  const progress = $id("heroVideoProgress");
  const fill = $id("heroVideoProgressFill");
  if (!progress || !fill) return;
  if (value === null) {
    progress.hidden = true;
    fill.style.width = "0%";
    return;
  }
  progress.hidden = false;
  const safe = Math.max(0, Math.min(100, value));
  fill.style.width = `${safe}%`;
}

function setHeroVideoUploading(isUploading) {
  const uploadBtn = $id("heroVideoUploadBtn");
  const clearBtn = $id("heroVideoClearBtn");
  if (uploadBtn) {
    uploadBtn.disabled = isUploading;
    uploadBtn.textContent = isUploading ? "Uploading…" : "Upload loop";
  }
  if (clearBtn) {
    clearBtn.disabled = isUploading;
  }
}

function populateHeroDisplayForm(heroVideo) {
  const fieldset = $id("heroVideoDisplayFieldset");
  const saveBtn = $id("heroDisplaySaveBtn");
  const desktop = heroVideo?.display?.desktop || HERO_VIDEO_DESKTOP_DEFAULT;
  const mobile = heroVideo?.display?.mobile || HERO_VIDEO_MOBILE_DEFAULT;
  const hasVideo = Boolean(heroVideo?.url);
  ["heroDesktopX", "heroDesktopY", "heroDesktopZoom", "heroMobileX", "heroMobileY", "heroMobileZoom"].forEach((id) => {
    const input = $id(id);
    if (!input) return;
    const value =
      id === "heroDesktopX"
        ? desktop.x
        : id === "heroDesktopY"
          ? desktop.y
          : id === "heroDesktopZoom"
            ? desktop.zoom
            : id === "heroMobileX"
              ? mobile.x
              : id === "heroMobileY"
                ? mobile.y
                : mobile.zoom;
    input.value = value;
  });
  const overlaySelect = $id("heroOverlayMode");
  if (overlaySelect) {
    overlaySelect.value = hasVideo ? normalizeHeroOverlayMode(heroVideo?.overlayMode) : HERO_OVERLAY_DEFAULT;
  }
  const overlayOpacity = hasVideo
    ? normalizeHeroOverlayOpacity(heroVideo?.overlayOpacity)
    : HERO_OVERLAY_OPACITY_DEFAULT;
  const overlayOpacityInput = $id("heroOverlayOpacity");
  if (overlayOpacityInput) {
    overlayOpacityInput.value = overlayOpacity;
  }
  setHeroOverlayOpacityPreview(overlayOpacity);
  const foregroundOpacity = hasVideo
    ? normalizeHeroForegroundOpacity(heroVideo?.foregroundOpacity)
    : HERO_FOREGROUND_OPACITY_DEFAULT;
  const backgroundOpacity = hasVideo
    ? normalizeHeroBackgroundOpacity(heroVideo?.backgroundOpacity)
    : HERO_BACKGROUND_OPACITY_DEFAULT;
  const foregroundInput = $id("heroForegroundOpacity");
  if (foregroundInput) {
    foregroundInput.value = foregroundOpacity;
  }
  const backgroundInput = $id("heroBackgroundOpacity");
  if (backgroundInput) {
    backgroundInput.value = backgroundOpacity;
  }
  setHeroForegroundOpacityPreview(foregroundOpacity);
  setHeroBackgroundOpacityPreview(backgroundOpacity);
  if (fieldset) fieldset.disabled = !hasVideo;
  if (saveBtn) saveBtn.disabled = !hasVideo;
}

function getHeroDisplayValuesFromForm() {
  const read = (id, fallback, min, max) => {
    const input = $id(id);
    if (!input) return fallback;
    const parsed = Number.parseFloat(input.value);
    const clamped = clampNumber(parsed, min, max);
    return clamped ?? fallback;
  };
  return {
    display: {
      desktop: {
        x: read("heroDesktopX", HERO_VIDEO_DESKTOP_DEFAULT.x, 0, 100),
        y: read("heroDesktopY", HERO_VIDEO_DESKTOP_DEFAULT.y, 0, 100),
        zoom: read("heroDesktopZoom", HERO_VIDEO_DESKTOP_DEFAULT.zoom, 0.8, 2.2),
      },
      mobile: {
        x: read("heroMobileX", HERO_VIDEO_MOBILE_DEFAULT.x, 0, 100),
        y: read("heroMobileY", HERO_VIDEO_MOBILE_DEFAULT.y, 0, 100),
        zoom: read("heroMobileZoom", HERO_VIDEO_MOBILE_DEFAULT.zoom, 0.8, 2.2),
      },
    },
    overlayMode: normalizeHeroOverlayMode($id("heroOverlayMode")?.value),
    overlayOpacity: normalizeHeroOverlayOpacity($id("heroOverlayOpacity")?.value),
    foregroundOpacity: normalizeHeroForegroundOpacity($id("heroForegroundOpacity")?.value),
    backgroundOpacity: normalizeHeroBackgroundOpacity($id("heroBackgroundOpacity")?.value),
  };
}

function setHeroDisplaySaving(isSaving) {
  const saveBtn = $id("heroDisplaySaveBtn");
  if (!saveBtn) return;
  if (isSaving) {
    saveBtn.dataset.prevDisabled = saveBtn.disabled ? "1" : "";
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  } else {
    if ("prevDisabled" in saveBtn.dataset) {
      saveBtn.disabled = saveBtn.dataset.prevDisabled === "1";
      delete saveBtn.dataset.prevDisabled;
    }
    saveBtn.textContent = "Save appearance";
  }
}

function initHeroDisplayCollapse() {
  const toggle = $id("heroDisplayCollapseBtn");
  const panel = $id("heroDisplayCollapse");
  if (!toggle || !panel || toggle.dataset.bound === "1") return;
  toggle.dataset.bound = "1";
  const setState = (open) => {
    panel.dataset.open = open ? "true" : "false";
    panel.hidden = !open;
    toggle.textContent = open ? "Hide controls" : "Show controls";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.dataset.open = open ? "true" : "false";
  };
  let isOpen = panel.dataset.open !== "false";
  setState(isOpen);
  toggle.addEventListener("click", () => {
    isOpen = !isOpen;
    setState(isOpen);
  });
}

async function handleHeroDisplayFormSubmit(event) {
  event.preventDefault();
  if (!adminHeroVideoState?.url) {
    showAdminToast("Upload a hero loop before adjusting framing.", "error");
    return;
  }
  const { display, overlayMode, overlayOpacity, foregroundOpacity, backgroundOpacity } = getHeroDisplayValuesFromForm();
  const heroVideoPayload = {
    ...adminHeroVideoState,
    display,
    overlayMode,
    overlayOpacity,
    foregroundOpacity,
    backgroundOpacity,
  };
  try {
    setHeroDisplaySaving(true);
    const res = await fetch("/api/admin/hero-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heroVideo: heroVideoPayload }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Save failed (${res.status})`);
    }
    adminHeroVideoState = data.heroVideo || heroVideoPayload;
    showAdminToast("Framing updated.", "success");
    populateHeroDisplayForm(adminHeroVideoState);
    applyHeroVideoPreviewStyles($id("heroVideoPreviewPlayer"), adminHeroVideoState);
    heroVideoCache = adminHeroVideoState;
    heroVideoCacheTime = Date.now();
    await loadHeroAmbientVideo({ payload: adminHeroVideoState });
  } catch (err) {
    console.error("Hero display save failed:", err);
    showAdminToast(err?.message || "Unable to save framing.", "error");
  } finally {
    setHeroDisplaySaving(false);
  }
}

async function refreshAdminHeroVideo(payload) {
  const preview = $id("heroVideoPreviewPlayer");
  const empty = $id("heroVideoEmptyState");
  const status = $id("heroVideoStatus");
  const updated = $id("heroVideoUpdated");
  const previewWrap = $id("heroVideoPreview");
  if (!preview || !empty) return null;
  let heroVideo = payload;
  if (!heroVideo) {
    try {
      const res = await fetch("/api/admin/hero-video", { cache: "no-store" });
      const { data, text } = await readResponsePayload(res);
      if (!res.ok) {
        throw new Error(pickResponseErrorMessage(data, text, `Request failed (${res.status})`));
      }
      heroVideo = data?.heroVideo || null;
      heroVideoCache = heroVideo;
      heroVideoCacheTime = Date.now();
    } catch (err) {
      console.warn("Hero video read failed:", err?.message || err);
      heroVideo = null;
    }
  }
  if (!heroVideo || !heroVideo.url) {
    adminHeroVideoState = null;
    populateHeroDisplayForm(null);
    if (status) status.textContent = "No hero loop uploaded yet.";
    if (updated) updated.textContent = "";
    empty.hidden = false;
    previewWrap?.classList.add("is-empty");
    preview.removeAttribute("src");
    try {
      preview.load();
    } catch {
      /* ignore */
    }
    applyHeroVideoPreviewStyles(preview, null);
    return null;
  }
  adminHeroVideoState = heroVideo;
  empty.hidden = true;
  previewWrap?.classList.remove("is-empty");
  if (status) status.textContent = heroVideo.originalFilename || "Uploaded video";
  if (updated) {
    updated.textContent = heroVideo.updatedAt
      ? `Updated ${new Date(heroVideo.updatedAt).toLocaleString()}`
      : "Updated just now";
  }
  if (heroVideo.thumbnail) {
    preview.poster = heroVideo.thumbnail;
  }
  if (preview.getAttribute("src") !== heroVideo.url) {
    preview.src = heroVideo.url;
    try {
      preview.load();
    } catch {
      /* noop */
    }
  }
  preview.play().catch(() => {});
  applyHeroVideoPreviewStyles(preview, heroVideo);
  populateHeroDisplayForm(heroVideo);
  return heroVideo;
}

async function handleHeroVideoUpload(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("video/")) {
    showAdminToast("Please choose a video file.", "error");
    return;
  }
  try {
    setHeroVideoUploading(true);
    setHeroVideoUploadProgress(4);
    const config = await getCloudinaryConfig();
    const media = await uploadFileToCloudinaryUnsigned(file, config, (pct) => {
      setHeroVideoUploadProgress(Math.min(90, pct * 0.9));
    });
    if (media.type !== "video") {
      throw new Error("Hero background must be a video.");
    }
    const { overlayMode, overlayOpacity, foregroundOpacity, backgroundOpacity } = getHeroDisplayValuesFromForm();
    const mediaPayload = { ...media, overlayMode, overlayOpacity, foregroundOpacity, backgroundOpacity };
    const res = await fetch("/api/admin/hero-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media: mediaPayload }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Hero update failed (${res.status})`);
    }
    setHeroVideoUploadProgress(100);
    showAdminToast("Hero background updated.", "success");
    heroVideoCache = data.heroVideo || null;
    heroVideoCacheTime = Date.now();
    adminHeroVideoState = data.heroVideo || null;
    populateHeroDisplayForm(adminHeroVideoState);
    await refreshAdminHeroVideo(data.heroVideo);
    await loadHeroAmbientVideo({ payload: data.heroVideo });
  } catch (err) {
    console.error("Hero upload failed:", err);
    showAdminToast(err?.message || "Upload failed. Please try again.", "error");
  } finally {
    setHeroVideoUploading(false);
    setTimeout(() => setHeroVideoUploadProgress(null), 600);
  }
}

async function handleHeroVideoClear() {
  if (!window.confirm("Remove the hero loop?")) return;
  try {
    setHeroVideoUploading(true);
    const res = await fetch("/api/admin/hero-video", { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    showAdminToast("Hero loop removed.", "success");
    heroVideoCache = null;
    heroVideoCacheTime = Date.now();
    await refreshAdminHeroVideo(null);
    await loadHeroAmbientVideo({ force: true });
  } catch (err) {
    console.error("Hero removal failed:", err);
    showAdminToast(err?.message || "Unable to remove hero loop.", "error");
  } finally {
    setHeroVideoUploading(false);
    setHeroVideoUploadProgress(null);
  }
}

async function initAdminHeroLoopPanel() {
  const preview = $id("heroVideoPreview");
  if (!preview) return;
  await refreshAdminHeroVideo();
  const uploadBtn = $id("heroVideoUploadBtn");
  const fileInput = $id("heroVideoInput");
  const clearBtn = $id("heroVideoClearBtn");
  uploadBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async (event) => {
    const target = event.target;
    const file = target?.files?.[0];
    if (!file) return;
    await handleHeroVideoUpload(file);
    target.value = "";
  });
  clearBtn?.addEventListener("click", () => handleHeroVideoClear());
  const displayForm = $id("heroVideoDisplayForm");
  displayForm?.addEventListener("submit", handleHeroDisplayFormSubmit);
  const overlayOpacityInput = $id("heroOverlayOpacity");
  overlayOpacityInput?.addEventListener("input", () => {
    setHeroOverlayOpacityPreview(overlayOpacityInput.value);
  });
  const foregroundOpacityInput = $id("heroForegroundOpacity");
  foregroundOpacityInput?.addEventListener("input", () => {
    setHeroForegroundOpacityPreview(foregroundOpacityInput.value);
  });
  const backgroundOpacityInput = $id("heroBackgroundOpacity");
  backgroundOpacityInput?.addEventListener("input", () => {
    setHeroBackgroundOpacityPreview(backgroundOpacityInput.value);
  });
  initHeroDisplayCollapse();
}


function initUploadFormToggle() {
  const wrapper = $id("uploadFormWrapper");
  const toggle = $id("toggleUploadPanel");
  if (!wrapper || !toggle) return;
  const setState = (open) => {
    wrapper.dataset.open = open ? "true" : "false";
    wrapper.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Close form" : "+ Add new project";
  };
  toggle.addEventListener("click", () => {
    const next = wrapper.dataset.open !== "true";
    setState(next);
    if (next) {
      wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  setState(false);
  window.openUploadFormPanel = () => setState(true);
  window.resetUploadFormPanel = () => setState(false);
}

function updateAdminStats(projects = []) {
  const published = projects.filter((p) => (p.status || "published") === "published").length;
  const drafts = projects.length - published;
  const featured = projects.filter((p) => p.featured).length;
  const setValue = (id, value) => {
    const el = $id(id);
    if (el) el.textContent = value;
  };
  setValue("statPublished", published);
  setValue("statDrafts", drafts);
  setValue("statFeatured", featured);
}

function setHeroMediaSelection(url) {
  currentHeroMediaUrl = url || "";
  refreshHeroIndicators();
}

function refreshHeroIndicators() {
  const heroField = $id("editHeroMedia");
  if (heroField) heroField.value = currentHeroMediaUrl || "";
  document.querySelectorAll("#editMediaList .media-item").forEach((item) => {
    const toggle = item.querySelector(".media-hero-toggle");
    const focusPanel = item.querySelector(".media-focus-panel");
    const focusControls = item.querySelector(".media-focus-controls");
    const overlay = item.querySelector(".media-focus-overlay");
    const mediaUrl = toggle?.dataset.mediaUrl || "";
    const isHero = mediaUrl && mediaUrl === currentHeroMediaUrl;
    item.classList.toggle("media-item--hero", Boolean(isHero));
    if (toggle) {
      toggle.textContent = isHero ? "Cover Image" : "Set as Cover";
      toggle.disabled = Boolean(isHero);
    }
    if (focusPanel) {
      if (isHero) {
        focusPanel.removeAttribute("hidden");
      } else {
        focusPanel.setAttribute("hidden", "hidden");
      }
    }
    if (focusControls && isHero) focusControls.dataset.mediaUrl = mediaUrl;
    if (overlay) {
      overlay.classList.toggle("is-hidden", !isHero);
      overlay.classList.toggle("is-active", isHero);
    }
    item.dispatchEvent(new Event("refreshFocusPreview"));
  });
}

function findNextAvailableHeroUrl(excludeUrl = "") {
  const items = document.querySelectorAll("#editMediaList .media-item");
  for (const item of items) {
    if (item.classList.contains("marked-remove")) continue;
    const toggle = item.querySelector(".media-hero-toggle");
    const url = toggle?.dataset.mediaUrl;
    if (url && url !== excludeUrl) {
      return url;
    }
  }
  return "";
}

/**************** FETCH ****************/
async function fetchAllProjects() {
  const cached = readProjectsCache();
  if (cached) return cached;
  const res = await fetch("/api/projects", { cache: "no-store" });
  const { data, text } = await readResponsePayload(res);
  if (!res.ok) {
    throw new Error(pickResponseErrorMessage(data, text, "Failed to fetch projects"));
  }
  if (!Array.isArray(data)) {
    throw new Error("Server returned an invalid project list.");
  }
  writeProjectsCache(data);
  return data;
}

async function ensureAdminSession() {
  const res = await fetch("/api/admin/session");
  if (res.ok) return true;
  window.location.href = "/admin-login.html?expired=1";
  throw new Error("Admin session required");
}

/************ ADMIN: LIST ************/
async function loadAdminProjects(page = 1) {
  const container = $id("adminProjects");
  const pagination = $id("adminProjectsPagination");
  if (!container || !pagination) return;

  const projects = await fetchAllProjects();
  const normalized = projects.map((project, idx) => ({
    ...project,
    client: typeof project.client === "string" ? project.client.trim() : "",
    media: Array.isArray(project.media) ? project.media : [],
    status:
      (project.status || "published").toString().toLowerCase() === "draft" ? "draft" : "published",
    tags: parseTagsInput(project.tags || []),
    featured:
      (project.status || "published").toString().toLowerCase() === "draft"
        ? false
        : Boolean(project.featured),
    __idx: idx,
  }));

  window.adminProjectsCache = normalized;
  updateAdminStats(normalized);
  adminAvailableTags = collectAdminTags(normalized);
  adminTagFilter = adminTagFilter.filter((tag) =>
    adminAvailableTags.some((available) => available.toLowerCase() === tag.toLowerCase()),
  );
  window.adminAvailableTags = adminAvailableTags;
  renderAdminTagFilters();
  applyAdminFilters(page);
}

function collectAdminTags(projects = []) {
  const map = new Map();
  projects.forEach((project) => {
    (Array.isArray(project.tags) ? project.tags : []).forEach((tag) => {
      if (typeof tag !== "string") return;
      const trimmed = tag.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (!map.has(key)) {
        map.set(key, trimmed);
      }
    });
  });
  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function renderAdminTagFilters() {
  const container = $id("adminTagFilters");
  if (!container) return;
  container.innerHTML = "";
  const tags = adminAvailableTags || [];
  if (!tags.length) {
    container.innerHTML =
      '<span class="muted" style="font-size:0.78rem; letter-spacing:0.12em;">No tags yet</span>';
    return;
  }
  tags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className =
      "admin-tag-chip" +
      (adminTagFilter.some((item) => item.toLowerCase() === tag.toLowerCase()) ? " active" : "");
    chip.textContent = tag;
    chip.addEventListener("click", () => toggleAdminTagFilter(tag));
    container.appendChild(chip);
  });
}

function toggleAdminTagFilter(tag) {
  const normalized = tag.toLowerCase();
  const existingIndex = adminTagFilter.findIndex(
    (item) => item.toLowerCase() === normalized,
  );
  if (existingIndex >= 0) {
    adminTagFilter.splice(existingIndex, 1);
  } else {
    adminTagFilter.push(tag);
  }
  renderAdminTagFilters();
  applyAdminFilters(1);
}

function resetAdminFilters() {
  adminStatusFilter = "all";
  adminTagFilter = [];
  const statusSelect = $id("adminStatusFilter");
  if (statusSelect) statusSelect.value = "all";
  renderAdminTagFilters();
  applyAdminFilters(1);
}

function readProjectsCache() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PROJECTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.data || !parsed.timestamp) return null;
    if (Date.now() - parsed.timestamp > PROJECTS_CACHE_TTL) {
      sessionStorage.removeItem(PROJECTS_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeProjectsCache(data) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      PROJECTS_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() }),
    );
  } catch {
    /* ignore storage quota errors */
  }
}

function invalidateProjectsCache() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(PROJECTS_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

function applyAdminFilters(page = 1) {
  window.adminStatusFilter = adminStatusFilter;
  window.adminTagFilter = adminTagFilter;
  const base = Array.isArray(window.adminProjectsCache) ? [...window.adminProjectsCache] : [];
  let filtered = base;

  if (adminStatusFilter !== "all") {
    filtered = filtered.filter(
      (project) => (project.status || "published") === adminStatusFilter,
    );
  }

  if (adminTagFilter.length) {
    const required = adminTagFilter.map((tag) => tag.toLowerCase());
    filtered = filtered.filter((project) => {
      const projectTags = Array.isArray(project.tags)
        ? project.tags.map((tag) => tag.toLowerCase())
        : [];
      return required.every((tag) => projectTags.includes(tag));
    });
  }

  window.adminProjectsDisplay = sortProjectsForDisplay([...filtered]);
  renderAdminProjectsPage(page);
}

function paginateAdminProjects(list = [], page = 1) {
  const totalPages = Math.max(1, Math.ceil(list.length / ADMIN_PROJECTS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * ADMIN_PROJECTS_PER_PAGE;
  return {
    items: list.slice(start, start + ADMIN_PROJECTS_PER_PAGE),
    totalPages,
    currentPage: safePage,
  };
}

function renderAdminProjectsPage(page = 1) {
  const container = $id("adminProjects");
  const pagination = $id("adminProjectsPagination");
  if (!container || !pagination) return;

  const display = Array.isArray(window.adminProjectsDisplay) ? window.adminProjectsDisplay : [];
  const paginationData = adminReorderMode
    ? { items: display, totalPages: 1, currentPage: 1 }
    : paginateAdminProjects(display, page);
  const { items, totalPages, currentPage } = paginationData;
  window.adminProjectsCurrentPage = currentPage;
  updateAdminReorderVisualState(container);

  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<div class="projects-empty-state">No projects to show yet.</div>';
    pagination.innerHTML = "";
    pagination.style.display = "none";
    return;
  }

  items.forEach((project) => {
    const originalIndex = project.__idx;
    const first = project.media?.[0];
    const thumb = getMediaThumb(first);
    const category = project.category || DEFAULT_PROJECT_CATEGORY;
    const summary = getProjectSnippet(project.description || "", 110);
    const titleText = escapeHtml(project.title || "");
    const categoryText = escapeHtml(category);
    const summaryText = escapeHtml(summary);
    const isFeatured = Boolean(project.featured);
    const cardClass = `admin-card${isFeatured ? " admin-card--featured" : ""}`;
    const featuredChip = isFeatured ? '<span class="admin-featured-chip">Featured</span>' : "";
    const featuredToggleLabel = isFeatured ? "Remove Featured" : "Mark Featured";
    const featuredToggleValue = isFeatured ? "false" : "true";
    const clientName = typeof project.client === "string" ? project.client.trim() : "";
    const clientText = clientName ? `<span class="admin-client">Client: ${escapeHtml(clientName)}</span>` : "";
    const status = (project.status || "published") === "draft" ? "draft" : "published";
    const statusChip = `<span class="admin-status-chip ${status}">${status === "draft" ? "Draft" : "Published"}</span>`;
    const statusToggleLabel = status === "draft" ? "Publish" : "Move to Draft";
    const statusToggleValue = status === "draft" ? "published" : "draft";
    const tags = Array.isArray(project.tags) ? project.tags : [];
    const tagsHtml = tags.length
      ? `<div class="admin-tags">${tags
          .map((tag) => `<span class="admin-tag">${escapeHtml(tag)}</span>`)
          .join("")}</div>`
      : "";

    const mediaMarkup = first?.type === "video"
      ? `<video src="${first.url}" poster="${thumb}" muted playsinline></video>`
      : `<img src="${thumb}" alt="${titleText}">`;

    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="${cardClass}" data-index="${originalIndex}" data-featured="${isFeatured}" data-status="${status}" data-order="${Number.isFinite(project.order) ? project.order : ""}">
        <button class="admin-card-handle" type="button" aria-hidden="true">&#8801;</button>
        ${mediaMarkup}
        <div class="admin-info">
          <div class="admin-title">
            <div class="admin-title-heading">
              <h3 style="margin:0">${titleText}</h3>
              ${statusChip}
              ${featuredChip}
            </div>
            <button class="more-btn" aria-label="More" onclick="toggleCardMenu(event, ${originalIndex})">&#8942;</button>
            <div class="more-menu" id="menu-${originalIndex}">
              <button onclick="openEditModal(${originalIndex})">Edit</button>
              <button onclick="toggleProjectStatus(${originalIndex}, '${statusToggleValue}')">${statusToggleLabel}</button>
              <button onclick="toggleFeatured(${originalIndex}, ${featuredToggleValue})">${featuredToggleLabel}</button>
              <button onclick="deleteProject(${originalIndex})">Delete</button>
            </div>
          </div>
          <span class="project-card-category">${categoryText}</span>
          ${clientText}
          ${tagsHtml}
          <p style="margin:.5rem 0 0">${summaryText}</p>
        </div>
      </div>
    `
    );
  });

  attachFallbacks(container);
  if (adminReorderMode) {
    bindAdminReorderEvents(container);
  }
  renderAdminPagination(pagination, totalPages, currentPage);
}

function renderAdminPagination(container, totalPages, currentPage) {
  if (!container) return;
  if (adminReorderMode) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  if (totalPages <= 1) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";
  const maxButtons = 5;
  let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let end = start + maxButtons - 1;
  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - maxButtons + 1);
  }

  const buttons = [];
  const addButton = (label, target, disabled = false, active = false) => {
    const classes = ["pagination-btn"];
    if (disabled) classes.push("disabled");
    if (active) classes.push("active");
    buttons.push(
      `<button class="${classes.join(" ")}"${
        disabled ? " disabled" : ` onclick="changeAdminProjectsPage(${target})"`
      }>${label}</button>`
    );
  };

  addButton("Prev", currentPage - 1, currentPage === 1);
  if (start > 1) {
    addButton("1", 1, false, currentPage === 1);
    if (start > 2) buttons.push('<span class="pagination-ellipsis">…</span>');
  }
  for (let i = start; i <= end; i += 1) {
    addButton(String(i), i, false, i === currentPage);
  }
  if (end < totalPages) {
    if (end < totalPages - 1) buttons.push('<span class="pagination-ellipsis">…</span>');
    addButton(String(totalPages), totalPages, false, currentPage === totalPages);
  }
  addButton("Next", currentPage + 1, currentPage === totalPages);

  container.innerHTML = buttons.join("");
}

function changeAdminProjectsPage(page) {
  renderAdminProjectsPage(page);
}

window.changeAdminProjectsPage = changeAdminProjectsPage;

function updateAdminReorderVisualState(container) {
  if (!container) return;
  const isReorder = adminReorderMode ? "1" : "0";
  container.dataset.reorder = isReorder;
  container.classList.toggle("projects-grid--reorder", adminReorderMode);
}

function bindAdminReorderEvents(container) {
  if (!container) return;
  const cards = container.querySelectorAll(".admin-card");
  cards.forEach((card) => {
    if (card.dataset.dragBound === "1") return;
    card.dataset.dragBound = "1";
    card.draggable = true;
    card.addEventListener("dragstart", (event) => startAdminCardDrag(card, event));
    card.addEventListener("dragover", handleAdminCardDragOver);
    card.addEventListener("drop", handleAdminCardDrop);
    card.addEventListener("dragend", handleAdminCardDragEnd);
    const handle = card.querySelector(".admin-card-handle");
    if (handle) {
      handle.draggable = true;
      handle.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        startAdminCardDrag(card, event);
      });
      handle.addEventListener("dragend", (event) => {
        event.stopPropagation();
        handleAdminCardDragEnd(event);
      });
    }
  });
}

function startAdminCardDrag(card, event) {
  if (!adminReorderMode || !card) return;
  adminDraggingCard = card;
  card.classList.add("dragging");
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", card.dataset.index || "");
    } catch {
      /* ignore */
    }
  }
}

function handleAdminCardDragOver(event) {
  if (!adminReorderMode || !adminDraggingCard) return;
  event.preventDefault();
  const target = event.currentTarget;
  if (target === adminDraggingCard) return;
  const container = target.parentElement;
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  if (after) {
    container.insertBefore(adminDraggingCard, target.nextSibling);
  } else {
    container.insertBefore(adminDraggingCard, target);
  }
}

function handleAdminCardDrop(event) {
  if (!adminReorderMode) return;
  event.preventDefault();
  updateAdminReorderState();
}

function handleAdminCardDragEnd(event) {
  const card = event.currentTarget || adminDraggingCard;
  if (card) {
    card.classList.remove("dragging");
  }
  adminDraggingCard = null;
}

function updateAdminReorderState() {
  const container = $id("adminProjects");
  if (!container) return;
  const ids = Array.from(container.querySelectorAll(".admin-card")).map((card) =>
    Number(card.dataset.index),
  );
  const lookup = new Map();
  window.adminProjectsDisplay.forEach((project) => {
    lookup.set(project.__idx, project);
  });
  const reordered = ids.map((id) => lookup.get(id)).filter(Boolean);
  if (reordered.length !== lookup.size) return;
  window.adminProjectsDisplay = reordered;
  adminReorderDirty = true;
  const saveBtn = $id("adminReorderSave");
  if (saveBtn) saveBtn.disabled = false;
}

function setAdminReorderMode(enable) {
  adminReorderMode = Boolean(enable);
  if (!adminReorderMode) {
    adminReorderDirty = false;
  }
  const toggleBtn = $id("toggleReorderBtn");
  if (toggleBtn) {
    toggleBtn.textContent = adminReorderMode ? "Exit Reorder" : "Reorder";
  }
  const controls = $id("adminReorderControls");
  if (controls) controls.hidden = !adminReorderMode;
  const saveBtn = $id("adminReorderSave");
  if (saveBtn) saveBtn.disabled = !adminReorderMode || !adminReorderDirty;
  updateAdminReorderVisualState($id("adminProjects"));
  renderAdminProjectsPage(adminReorderMode ? 1 : window.adminProjectsCurrentPage || 1);
}

function handleAdminReorderCancel() {
  if (adminReorderDirty && !window.confirm("Discard unsaved order changes?")) {
    return;
  }
  adminReorderDirty = false;
  setAdminReorderMode(false);
  loadAdminProjects(window.adminProjectsCurrentPage || 1);
}

async function saveAdminReorderChanges() {
  if (!adminReorderMode) return;
  if (!adminReorderDirty) {
    showAdminToast("Drag projects before saving the order.", "info");
    return;
  }
  const saveBtn = $id("adminReorderSave");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }
  try {
    const updates = [];
    window.adminProjectsDisplay.forEach((project, idx) => {
      const targetOrder = idx + 1;
      if (project.order !== targetOrder) {
        updates.push({ index: project.__idx, order: targetOrder });
      }
    });
    if (!updates.length) {
      adminReorderDirty = false;
      showAdminToast("Project order unchanged.", "info");
      setAdminReorderMode(false);
      return;
    }
    for (const update of updates) {
      const res = await fetch(`/api/projects/${update.index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: update.order }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Order update failed (${res.status})`);
      }
    }
    adminReorderDirty = false;
    showAdminToast("Project order updated.", "success");
    setAdminReorderMode(false);
    await loadAdminProjects(window.adminProjectsCurrentPage || 1);
    if (document.getElementById("projectsGrid")) {
      await loadPublicProjects(window.publicProjectsCurrentPage || 1);
    }
    broadcastProjectsUpdate({ action: "order" });
  } catch (err) {
    console.error("Reorder save error:", err);
    showAdminToast(err?.message || "Unable to save order.", "error");
    if (saveBtn) saveBtn.disabled = false;
  } finally {
    if (saveBtn) saveBtn.textContent = "Save order";
  }
}
function toggleCardMenu(e, i) {
  e.stopPropagation();
  document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
  const menu = $id(`menu-${i}`);
  if (menu) menu.classList.toggle("open");
}
document.addEventListener("click", () => {
  document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
});

async function toggleProjectStatus(index, nextStatus = "published") {
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex) || numericIndex < 0) {
    showAdminToast("Invalid project reference.", "error");
    return;
  }

  const normalized =
    (nextStatus || "published").toString().toLowerCase() === "draft" ? "draft" : "published";

  try {
    const res = await fetch(`/api/projects/${numericIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: normalized }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }

    document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
    showAdminToast(
      normalized === "draft" ? "Project moved to draft." : "Project published.",
      "success",
    );

    await loadAdminProjects(window.adminProjectsCurrentPage || 1);
    if (document.getElementById("projectsGrid")) {
      const currentPage = window.publicProjectsCurrentPage || 1;
      try {
        await loadPublicProjects(currentPage);
      } catch (refreshErr) {
        console.error("Public gallery refresh failed:", refreshErr);
      }
    }

    broadcastProjectsUpdate({ action: "status", index: numericIndex, status: normalized });
    return data;
  } catch (err) {
    console.error("Status toggle error:", err);
    showAdminToast(err.message || "Unable to update project status.", "error");
    return null;
  }
}

function openEditModal(index) {
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex) || numericIndex < 0) {
    showAdminToast("Invalid project reference.", "error");
    return;
  }

  const projects = Array.isArray(window.adminProjectsCache) ? window.adminProjectsCache : [];
  const project = projects[numericIndex];
  if (!project) {
    showAdminToast("Project not found.", "error");
    return;
  }

  currentEditIndex = numericIndex;
  removedMedia = [];

  const titleInput = $id("editTitle");
  const clientInput = $id("editClient");
  const descriptionInput = $id("editDescription");
  const categoryInput = $id("editCategory");
  const statusSelect = $id("editStatus");
  const tagsInput = $id("editTags");
  const orderInput = $id("editOrder");

  if (titleInput) titleInput.value = project.title || "";
  if (clientInput) clientInput.value = project.client || "";
  if (descriptionInput) descriptionInput.value = project.description || "";
  if (categoryInput) categoryInput.value = project.category || "";
  if (statusSelect) statusSelect.value = (project.status || "published") === "draft" ? "draft" : "published";
  if (tagsInput) tagsInput.value = Array.isArray(project.tags) ? project.tags.join(", ") : "";
  if (orderInput) orderInput.value = Number.isFinite(project.order) ? project.order : "";

  currentHeroMediaUrl = deriveHeroMediaUrl(project);
  const heroField = $id("editHeroMedia");
  if (heroField) heroField.value = currentHeroMediaUrl || "";

  renderEditMediaList(project);
  refreshHeroIndicators();

  const modal = $id("editModal");
  if (modal) {
    modal.style.display = "flex";
    requestAnimationFrame(() => modal.classList.add("show"));
  }
}

function closeEditModal() {
  const modal = $id("editModal");
  if (modal) {
    modal.classList.remove("show");
    setTimeout(() => {
      modal.style.display = "none";
    }, 200);
  }
  currentEditIndex = null;
  removedMedia = [];
  currentHeroMediaUrl = "";
  const heroField = $id("editHeroMedia");
  if (heroField) heroField.value = "";
  const editForm = $id("editForm");
  if (editForm) {
    editForm.reset();
  }
}

function renderEditMediaList(project) {
  const list = $id("editMediaList");
  if (!list) return;
  list.innerHTML = "";
  const mediaItems = Array.isArray(project?.media) ? project.media : [];
  if (!mediaItems.length) {
    list.innerHTML = '<p class="muted">No media uploaded for this project yet.</p>';
    return;
  }

  mediaItems.forEach((media, idx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "media-item";
    const thumb = getMediaThumb(media);
    const focus = getMediaFocus(media);
    const focusX = focus ? focus.x : 50;
    const focusY = focus ? focus.y : 50;
    const focusZoom = focus ? focus.zoom : 1;
    const safeUrl = escapeHtml(media.url || `media-${idx}`);
    const isHero = Boolean(currentHeroMediaUrl && media?.url === currentHeroMediaUrl);
    const preview =
      media?.type === "video"
        ? `<video class="media-preview" src="${media.url}" poster="${thumb}" muted playsinline${buildMediaFocusAttr(
            media,
          )}></video>`
        : `<img class="media-preview" src="${thumb}" alt="Media ${idx + 1}" loading="lazy" decoding="async"${buildMediaFocusAttr(
            media,
          )}>`;
    const previewMarkup = `
      <div class="media-preview-wrapper">
        ${preview}
        <div class="media-focus-overlay${isHero ? " is-active" : " is-hidden"}" data-media-url="${safeUrl}">
          <div class="media-focus-handle" role="presentation"></div>
          <div class="media-focus-readout">
            <span>H: <strong data-focus-overlay="x">${Math.round(focusX)}%</strong></span>
            <span>V: <strong data-focus-overlay="y">${Math.round(focusY)}%</strong></span>
          </div>
          <span class="media-focus-instruction">Drag to reposition cover</span>
        </div>
      </div>
    `;
    wrapper.innerHTML = `
      ${previewMarkup}
      <button type="button" class="media-remove" aria-label="Delete media">Delete</button>
      <button type="button" class="media-hero-toggle" data-media-url="${safeUrl}">
        ${isHero ? "Cover Image" : "Set as Cover"}
      </button>
      <div class="media-focus-panel"${isHero ? "" : " hidden"}>
        <div class="media-focus-panel__header">
          <span>Cover framing</span>
          <button type="button" class="media-focus-reset" aria-label="Reset focus">Reset</button>
        </div>
        <div class="media-focus-controls" data-media-url="${safeUrl}">
          <input type="hidden" data-focus-axis="x" value="${focusX}" />
          <input type="hidden" data-focus-axis="y" value="${focusY}" />
          <div class="media-focus-row">
            <div class="media-focus-labels">
              <label>Zoom</label>
              <span class="media-focus-value" data-focus-value="zoom">${Math.round(
                focusZoom * 100,
              )}%</span>
            </div>
            <input type="range" min="100" max="200" step="1" value="${Math.round(
              focusZoom * 100,
            )}" data-focus-axis="zoom" />
          </div>
        </div>
      </div>
      ${isHero ? "" : '<p class="media-focus-hint">Select this media as the cover to unlock positioning controls.</p>'}
      <p class="media-remove-note">Marked for deletion. Save changes to confirm.</p>
    `;
    if (isHero) {
      wrapper.classList.add("media-item--hero");
    }
    const removeBtn = wrapper.querySelector(".media-remove");
    const mark = () => {
      if (!removedMedia.some((entry) => entry?.url === media.url)) {
        removedMedia.push({
          url: media.url,
          thumbnail: media.thumbnail,
          cloudinaryId: media.cloudinaryId,
          cloudinaryResourceType: media.cloudinaryResourceType,
        });
      }
      wrapper.classList.add("marked-remove");
      if (media.url && media.url === currentHeroMediaUrl) {
        const fallback = findNextAvailableHeroUrl(media.url);
        setHeroMediaSelection(fallback);
      }
    };
    const unmark = () => {
      removedMedia = removedMedia.filter((entry) => entry?.url !== media.url);
      wrapper.classList.remove("marked-remove");
      if (!currentHeroMediaUrl && media.url) {
        setHeroMediaSelection(media.url);
      }
    };
    const refreshRemoveUi = () => {
      if (removeBtn) {
        removeBtn.textContent = wrapper.classList.contains("marked-remove") ? "Undo delete" : "Delete";
      }
    };
    removeBtn?.addEventListener("click", () => {
      if (wrapper.classList.contains("marked-remove")) {
        unmark();
      } else {
        if (!window.confirm("Remove this media from the project?")) return;
        mark();
      }
      refreshRemoveUi();
    });
    refreshRemoveUi();

    const heroToggle = wrapper.querySelector(".media-hero-toggle");
    heroToggle?.addEventListener("click", () => {
      if (!media.url) return;
      setHeroMediaSelection(media.url);
    });

    const focusPanel = wrapper.querySelector(".media-focus-panel");
    const focusControls = wrapper.querySelector(".media-focus-controls");
    const previewEl = wrapper.querySelector(".media-preview");
    const previewWrapper = wrapper.querySelector(".media-preview-wrapper");
    const overlay = wrapper.querySelector(".media-focus-overlay");
    if (focusControls && previewEl) {
      const updatePreviewFocus = () => {
        const xInput = focusControls.querySelector('input[data-focus-axis="x"]');
        const yInput = focusControls.querySelector('input[data-focus-axis="y"]');
        const zoomInput = focusControls.querySelector('input[data-focus-axis="zoom"]');
        const x = clampMediaFocusValue(Number(xInput?.value));
        const y = clampMediaFocusValue(Number(yInput?.value));
        const zoom = clampMediaZoomValue(Number(zoomInput?.value) / 100);
        const posX = x === null ? 50 : x;
        const posY = y === null ? 50 : y;
        previewEl.style.objectPosition = `${posX}% ${posY}%`;
        previewEl.style.transformOrigin = `${posX}% ${posY}%`;
        previewEl.style.transform = `scale(${zoom === null ? 1 : zoom})`;
        previewEl.style.setProperty("--media-focus-x", `${posX}%`);
        previewEl.style.setProperty("--media-focus-y", `${posY}%`);
        previewEl.style.setProperty("--media-zoom", zoom === null ? 1 : zoom);
        const overlayHandle = overlay?.querySelector(".media-focus-handle");
        const overlayValueX = overlay?.querySelector('[data-focus-overlay="x"]');
        const overlayValueY = overlay?.querySelector('[data-focus-overlay="y"]');
        if (overlayHandle) {
          overlayHandle.style.transform = `translate(${posX}%, ${posY}%)`;
        }
        if (overlayValueX) overlayValueX.textContent = `${Math.round(posX)}%`;
        if (overlayValueY) overlayValueY.textContent = `${Math.round(posY)}%`;
      };
      focusControls.querySelectorAll('input[data-focus-axis]').forEach((input) => {
        const axis = input.dataset.focusAxis;
        const valueLabel = focusControls.querySelector(`[data-focus-value="${axis}"]`);
        const syncLabel = () => {
          if (axis === "zoom") {
            const zoom = clampMediaZoomValue(Number(input.value) / 100);
            if (valueLabel) {
              valueLabel.textContent = `${Math.round((zoom === null ? 1 : zoom) * 100)}%`;
            }
          } else {
            const numeric = clampMediaFocusValue(Number(input.value));
            const displayValue = numeric === null ? 50 : numeric;
            if (valueLabel) {
              valueLabel.textContent = `${Math.round(displayValue)}%`;
            }
          }
          updatePreviewFocus();
        };
        input.addEventListener("input", syncLabel);
        input.addEventListener("change", syncLabel);
      });
      focusPanel?.querySelector(".media-focus-reset")?.addEventListener("click", () => {
        focusControls.querySelectorAll('input[data-focus-axis]').forEach((input) => {
          if (input.dataset.focusAxis === "zoom") {
            input.value = "100";
          } else {
            input.value = "50";
          }
          const axis = input.dataset.focusAxis;
          const label = focusControls.querySelector(`[data-focus-value="${axis}"]`);
          if (label) {
            label.textContent = axis === "zoom" ? "100%" : "50%";
          }
        });
        updatePreviewFocus();
      });
      updatePreviewFocus();
      setupFocusOverlay(previewWrapper, overlay, focusControls, updatePreviewFocus);
      wrapper.addEventListener("refreshFocusPreview", () => updatePreviewFocus());
    }
    list.appendChild(wrapper);
  });
}

/************ ADMIN: UPLOAD ************/
$id("uploadForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const fileInput = form.querySelector('input[name="media"]');
  const files = Array.from(fileInput?.files || []);
  if (!files.length) {
    showAdminToast("Please select at least one image or video file.", "error");
    return;
  }

  const formData = new FormData(form);
  const progressWrap = $id("uploadProgress");
  const progressFill = $id("uploadProgressFill");
  const progressLabel = $id("uploadProgressLabel");
  const submitBtn = form.querySelector('button[type="submit"]');

  const setProgress = (value) => {
    if (!progressWrap || !progressFill || !progressLabel) return;
    progressWrap.style.display = "flex";
    progressFill.style.width = `${Math.min(100, Math.max(0, value))}%`;
    progressLabel.textContent = `${Math.min(100, Math.max(0, Math.round(value)))}%`;
  };

  const resetProgress = () => {
    if (!progressWrap || !progressFill || !progressLabel) return;
    setTimeout(() => {
      progressWrap.style.display = "none";
      progressFill.style.width = "0%";
      progressLabel.textContent = "0%";
    }, 600);
  };

  const setSubmittingState = (isSubmitting) => {
    if (!submitBtn) return;
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting ? "Uploading..." : "Upload Project";
  };

  try {
    setSubmittingState(true);
    setProgress(5);

    const config = await getCloudinaryConfig();
    const uploadedMedia = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const media = await uploadFileToCloudinaryUnsigned(file, config, (pct) => {
        const overall = 5 + ((i + pct / 100) / files.length) * 80;
        setProgress(Math.min(90, overall));
      });
      uploadedMedia.push(media);
    }

    const statusValue = (formData.get("status") || "published").toString().toLowerCase();
    const status = statusValue === "draft" ? "draft" : "published";
    const tags = parseTagsInput(formData.get("tags") || "");

    const orderValue = parseOrderInputValue(formData.get("order"));

    const payload = {
      title: (formData.get("title") || "").toString().trim(),
      client: (formData.get("client") || "").toString().trim(),
      description: (formData.get("description") || "").toString().trim(),
      category: (formData.get("category") || "").toString().trim(),
      media: uploadedMedia,
      status,
      tags,
      order: orderValue,
    };

    setProgress(92);

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Project save failed (${res.status})`);
    }

    setProgress(100);
    form.reset();
    if (fileInput) fileInput.value = "";
    const statusSelect = $id("uploadStatus");
    if (statusSelect) statusSelect.value = "published";
    const tagsField = $id("uploadTags");
    if (tagsField) tagsField.value = "";
    showAdminToast("Project uploaded successfully!", "success");
    window.resetUploadFormPanel?.();

    try {
      await loadAdminProjects(1);
      if (window.loadPublicProjects) {
        await loadPublicProjects(1);
      }
    } catch (refreshErr) {
      console.error(refreshErr);
      showAdminToast("Project list refresh failed. Please reload.", "error");
    }

    broadcastProjectsUpdate({ action: "upload" });
    resetProgress();
  } catch (err) {
    console.error("Upload error:", err);
    showAdminToast(err?.message || "Upload failed. Please try again.", "error");
    resetProgress();
  } finally {
    setSubmittingState(false);
  }
});

/************ ADMIN: SAVE EDIT ************/
document.getElementById("editForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentEditIndex === null) return;

  const editedIndex = currentEditIndex;
  const title = document.getElementById("editTitle").value.trim();
  const client = document.getElementById("editClient")?.value.trim() || "";
  const description = document.getElementById("editDescription").value.trim();
  const category = document.getElementById("editCategory").value.trim();
  const newFilesInput = document.getElementById("editNewMedia");
  const newFiles = Array.from(newFilesInput?.files || []);
  const saveBtn = e.submitter || document.querySelector('#editForm button[type="submit"]');
  const statusSelect = document.getElementById("editStatus");
  const tagsInput = document.getElementById("editTags");
  const orderInput = document.getElementById("editOrder");
  const statusValue = statusSelect ? statusSelect.value : "published";
  const normalizedStatus = statusValue === "draft" ? "draft" : "published";
  const tags = parseTagsInput(tagsInput?.value || "");
  const orderValue = parseOrderInputValue(orderInput?.value);

  if (saveBtn) {
    saveBtn.dataset.originalText = saveBtn.dataset.originalText || saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  const payload = {
    title: title || "",
    client,
    description: description || "",
    category: category || "",
    status: normalizedStatus,
    tags,
    order: orderValue,
    removed: Array.isArray(removedMedia) ? removedMedia : [],
    newMedia: [],
  };
  const removalUrls = new Set(
    (Array.isArray(removedMedia) ? removedMedia : [])
      .map((entry) => entry?.url)
      .filter((url) => typeof url === "string" && url),
  );
  const focusEntries = [];
  document.querySelectorAll("#editMediaList .media-focus-controls").forEach((control) => {
    const url = control.dataset.mediaUrl;
    if (!url || removalUrls.has(url)) return;
    if (!currentHeroMediaUrl || url !== currentHeroMediaUrl) return;
    const xVal = clampMediaFocusValue(
      Number(control.querySelector('input[data-focus-axis="x"]')?.value),
    );
    const yVal = clampMediaFocusValue(
      Number(control.querySelector('input[data-focus-axis="y"]')?.value),
    );
    const zoomInput = control.querySelector('input[data-focus-axis="zoom"]');
    const zoomVal = clampMediaZoomValue(Number(zoomInput?.value) / 100);
    if (xVal === null && yVal === null && zoomVal === null) return;
    const focus = {};
    if (xVal !== null) focus.x = xVal;
    if (yVal !== null) focus.y = yVal;
    if (zoomVal !== null) focus.zoom = zoomVal;
    focusEntries.push({ url, focus });
  });
  if (focusEntries.length) {
    payload.mediaFocus = focusEntries;
  }
  const heroValue =
    currentHeroMediaUrl && !removalUrls.has(currentHeroMediaUrl) ? currentHeroMediaUrl : "";
  payload.heroMediaUrl = heroValue;

  try {
    if (newFiles.length) {
      const config = await getCloudinaryConfig();
      for (let i = 0; i < newFiles.length; i += 1) {
        const media = await uploadFileToCloudinaryUnsigned(newFiles[i], config);
        payload.newMedia.push(media);
      }
    }

    const res = await fetch(`/api/projects/${editedIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Edit failed");

    alert("Changes saved successfully!");
    closeEditModal();
    if (newFilesInput) newFilesInput.value = "";

    try {
      await loadAdminProjects(window.adminProjectsCurrentPage || 1);
      if (window.loadPublicProjects) {
        await loadPublicProjects();
      }
    } catch (refreshErr) {
      console.error("Public gallery refresh failed:", refreshErr);
    }
    broadcastProjectsUpdate({ action: "edit", index: editedIndex });
  } catch (err) {
    console.error("Edit error:", err);
    alert("Error: " + (err.message || "Something went wrong while saving changes"));
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = saveBtn.dataset.originalText || "Save Changes";
    }
  }
});

/************ ADMIN: DELETE ************/
async function deleteProject(index) {
  if (!confirm("Delete this project and its files?")) return;
  try {
    const res = await fetch(`/api/projects/${index}`, { method: "DELETE" });
    const { data, text } = await readResponsePayload(res);
    if (!res.ok || !data?.ok) {
      throw new Error(pickResponseErrorMessage(data, text, "Delete failed"));
    }
    alert(`Deleted: ${data.removed?.title || "(untitled)"}`);
    const targetPage = window.adminProjectsCurrentPage || 1;
    await loadAdminProjects(targetPage);
    if (window.loadPublicProjects) {
      const currentPublicPage = window.publicProjectsCurrentPage || 1;
      try {
        await loadPublicProjects(currentPublicPage);
      } catch (refreshErr) {
        console.error("Public gallery refresh failed:", refreshErr);
      }
    }
    broadcastProjectsUpdate({ action: "delete", index });
  } catch (err) {
    console.error(err);
    alert("Error: " + err.message);
  }
}

async function toggleFeatured(index, enable = true) {
  const numericIndex = Number(index);
  if (!Number.isInteger(numericIndex) || numericIndex < 0) {
    showAdminToast("Invalid project reference.", "error");
    return;
  }

  const shouldEnable =
    enable === true ||
    enable === 1 ||
    (typeof enable === "string" && enable.toLowerCase() === "true");

  try {
    const fd = new FormData();
    fd.append("featured", shouldEnable ? "true" : "false");
    const res = await fetch(`/api/projects/${numericIndex}`, {
      method: "PUT",
      body: fd,
    });
    const { data, text } = await readResponsePayload(res);
    if (!res.ok || !data?.ok) {
      throw new Error(pickResponseErrorMessage(data, text, `Request failed (${res.status})`));
    }

    document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
    showAdminToast(
      shouldEnable ? "Project marked as featured." : "Removed from featured list.",
      "success",
    );

    await loadAdminProjects(window.adminProjectsCurrentPage || 1);
    if (document.getElementById("projectsGrid")) {
      const currentPage = window.publicProjectsCurrentPage || 1;
      try {
        await loadPublicProjects(currentPage);
      } catch (refreshErr) {
        console.error("Public gallery refresh failed:", refreshErr);
      }
    }
    broadcastProjectsUpdate({ action: "featured", index: numericIndex, enable: shouldEnable });

    return data;
  } catch (err) {
    console.error("Featured toggle error:", err);
    showAdminToast(err.message || "Unable to update featured status.", "error");
    return null;
  }
}
window.toggleFeatured = toggleFeatured;

/************ INIT ************/
/************ INIT ************/
document.addEventListener("DOMContentLoaded", async () => {
  setupProjectsSync();
  setupModalInteractions();
  loadHeroAmbientVideo().catch(() => {});
  scheduleIdle(() => {
    applySectionObserver();
  });
  scheduleIdle(() => {
    initHeroParallax();
    setupHeroBlend();
    initCtaBanner();
  });

  const statusFilterElement = $id("adminStatusFilter");
  if (statusFilterElement) {
    statusFilterElement.value = adminStatusFilter;
    statusFilterElement.addEventListener("change", (event) => {
      const value = (event.target.value || "all").toString().toLowerCase();
      adminStatusFilter = ["all", "published", "draft"].includes(value) ? value : "all";
      applyAdminFilters(1);
    });
  }

  const resetFiltersBtn = $id("adminResetFilters");
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener("click", () => resetAdminFilters());
  }

  if (document.getElementById("projectsGrid")) {
    // On public index.html
    const initialPage =
      Number.isFinite(Number(window.publicProjectsCurrentPage)) && Number(window.publicProjectsCurrentPage) > 0
        ? Number(window.publicProjectsCurrentPage)
        : 1;
    await loadPublicProjects(initialPage).catch(console.error);
  }

  if (document.getElementById("adminProjects")) {
    // On admin.html
    try {
      await ensureAdminSession();
      await initAdminHeroLoopPanel();
      initUploadFormToggle();
      const reorderBtn = $id("toggleReorderBtn");
      reorderBtn?.addEventListener("click", () => {
        if (adminReorderMode) {
          handleAdminReorderCancel();
        } else {
          setAdminReorderMode(true);
        }
      });
      $id("adminReorderCancel")?.addEventListener("click", handleAdminReorderCancel);
      $id("adminReorderSave")?.addEventListener("click", saveAdminReorderChanges);
      await loadAdminProjects(1);
    } catch (err) {
      console.error(err);
    }
  }

  // Modal close for admin
  window.addEventListener("click", (e) => {
    const modal = document.getElementById("editModal");
    if (e.target === modal) closeEditModal();
  });
});

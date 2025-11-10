// @ts-nocheck
/************ PUBLIC (index.html) ************/
const VIDEO_THUMB_FALLBACK = "/static/default-video-thumb.jpg";
const PROJECTS_PER_PAGE = 12;
const DEFAULT_PROJECT_CATEGORY = "General";
const ADMIN_PROJECTS_PER_PAGE = PROJECTS_PER_PAGE;
const prefetchedAssets = new Set();
const CLOUDINARY_HOST_PATTERN = /res\.cloudinary\.com/i;
const MEDIA_TRANSFORMS = {
  grid: "f_auto,q_auto,c_fill,w_720,h_520",
  hero: "f_auto,q_auto,c_fill,w_1280,h_720",
  detail: "f_auto,q_auto,c_fill,w_960,h_720",
  thumb: "f_auto,q_auto,c_fill,w_480,h_360",
};
let heroParallaxInitialized = false;
let heroParallaxFrame = null;
let projectCardObserver = null;
let sectionObserver = null;
let featuredMediaObserver = null;
let heroBlendObserver = null;
let ctaContactObserver = null;
if (typeof window !== 'undefined') {
  window.publicProjectsFilter = window.publicProjectsFilter || 'All';
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
      return parsed.toString();
    }
    parsed.pathname = `${prefix}/upload/${transform}/${suffix.replace(/^\/+/, "")}`;
    return parsed.toString();
  } catch {
    return url;
  }
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
      .then((res) => {
        if (!res.ok) {
          throw new Error("Cloudinary configuration is unavailable.");
        }
        return res.json();
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

function sortProjectsBySpotlight(projects = []) {
  if (!Array.isArray(projects)) return [];
  const spotlight = [];
  const others = [];
  projects.forEach((proj) => {
    if (proj?.spotlight) {
      spotlight.push(proj);
    } else {
      others.push(proj);
    }
  });
  return [...spotlight, ...others];
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
      const candidate =
        media.type === "video"
          ? media.thumbnail || ""
          : media.url || media.thumbnail || "";
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
      const translateX = (currentX * depth * 48).toFixed(2);
      const translateY = (currentY * depth * 36).toFixed(2);
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

  showProjectsSkeleton(grid);

  const currentPage =
    typeof window !== "undefined" && Number.isFinite(Number(window.publicProjectsCurrentPage))
      ? Number(window.publicProjectsCurrentPage)
      : 1;
  const requestedPage =
    Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : currentPage;

  try {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error("Failed to fetch projects");

    const rawProjects = await res.json();
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
        normalized.spotlight = normalized.status === "published" && Boolean(project.spotlight);
        return normalized;
      })
      .reverse();

    const visibleProjects = enriched.filter((proj) => (proj.status || "published") !== "draft");
    const prioritized = sortProjectsBySpotlight(visibleProjects);

    prioritized.forEach((p, displayIndex) => {
      p.status = (p.status || "published") === "draft" ? "draft" : "published";
      p.spotlight = Boolean(p.spotlight);
      p.__displayIndex = displayIndex;
    });

    window.publicProjectsCache = prioritized;
    if (typeof window.publicProjectsFilter !== "string") {
    window.publicProjectsFilter = "All";
  }

  if (window.publicProjectsFilter !== "All") {
    const hasActive = prioritized.some(
        (proj) => (proj.category || DEFAULT_PROJECT_CATEGORY).toLowerCase() ===
          window.publicProjectsFilter.toLowerCase(),
      );
      if (!hasActive) {
        window.publicProjectsFilter = "All";
      }
    }

    buildProjectFilters(prioritized);
    preloadProjectMedia(prioritized, 6);

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
      const isFeatured = Boolean(p.spotlight);
      const featuredVideo = isFeatured
        ? mediaItems.find((mediaItem) => mediaItem && mediaItem.type === "video")
        : null;
      const heroOverride = findHeroMediaCandidate(mediaItems, p.heroMediaUrl);
      const heroMedia = heroOverride || featuredVideo || firstMedia;
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
      const inlineShareButton = isFeatured ? buildShareButton(displayIndex, "project-card-share--inline") : "";
      const altText = escapeHtml(`${p.title || "Project"} showcase`);
      const heroMediaIndex = mediaItems.indexOf(heroMedia);
      const safeMediaIndex = heroMediaIndex >= 0 ? heroMediaIndex : 0;
      const shareId = buildProjectShareId(p, sourceIndex);
      const detailPath = `/p/${shareId}`;
      const mediaCountText = formatMediaCount(mediaItems);
      const actionsShareMarkup = isFeatured ? "" : shareButtonDefault;
      const focusAttr = buildMediaFocusAttr(heroMedia);
      const imageAttrs = `loading="lazy" decoding="async" fetchpriority="${isFeatured && idx === 0 ? "high" : "auto"}"`;

    let mediaTag = "";
    if (featuredVideo) {
      mediaTag = `
        <video src="${featuredVideo.url}" poster="${heroThumb}" muted playsinline loop preload="metadata" data-autoplay="1" aria-label="${altText}"${focusAttr}></video>
      `;
    } else if (heroMedia.type === "video") {
      mediaTag = `
        <div class="video-thumb">
          <img src="${heroThumb}" alt="${altText}" loading="lazy" decoding="async"${focusAttr}>
          <span class="play-icon" aria-hidden="true">&#9658;</span>
        </div>
      `;
    } else {
      mediaTag = `<img src="${heroThumb}" alt="${altText}" ${imageAttrs}${focusAttr}>`;
    }

    const badgeHtml = isFeatured ? '<span class="project-card-badge">Spotlight</span>' : "";
    const cardClass = `project-card ${isFeatured ? "project-card--featured" : ""}`.trim();
    grid.insertAdjacentHTML(
      "beforeend",
      `
      <article class="${cardClass}" id="project-${displayIndex}" data-index="${sourceIndex}" data-display-index="${displayIndex}" data-media-index="${safeMediaIndex}" style="--card-delay:${delay}s">
        <a class="project-card-link" href="${detailPath}" aria-label="View ${titleText}">
          <div class="project-card-media">
            ${mediaTag}
          </div>
          <div class="project-card-meta">
            ${inlineShareButton}
            ${badgeHtml}
            <span class="project-card-category">${categoryText}</span>
            <h3>${titleText}</h3>
            ${clientHtml}
            ${snippetHtml}
          </div>
        </a>
        <div class="project-card-actions">
          <span class="project-card-count">${mediaCountText}</span>
          ${actionsShareMarkup}
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

  if (media.type === "image") {
    modalMedia.innerHTML = `
      <div class="modal-media-wrapper">
        <img src="${media.url}" alt="${p.title}" class="modal-img modal-media-el">
      </div>`;
  } else {
    modalMedia.innerHTML = `
      <div class="modal-media-wrapper">
        <video src="${media.url}" poster="${poster}" controls muted playsinline preload="metadata" class="modal-video modal-media-el"></video>
      </div>`;
  }
  attachFallbacks(modalMedia);

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

function setHeroMediaSelection(url) {
  currentHeroMediaUrl = url || "";
  refreshHeroIndicators();
}

function refreshHeroIndicators() {
  const heroField = $id("editHeroMedia");
  if (heroField) heroField.value = currentHeroMediaUrl || "";
  document.querySelectorAll("#editMediaList .media-item").forEach((item) => {
    const toggle = item.querySelector(".media-hero-toggle");
    const focusControls = item.querySelector(".media-focus-controls");
    const mediaUrl = toggle?.dataset.mediaUrl || "";
    const isHero = mediaUrl && mediaUrl === currentHeroMediaUrl;
    item.classList.toggle("media-item--hero", Boolean(isHero));
    if (toggle) {
      toggle.textContent = isHero ? "Cover Image" : "Set as Cover";
      toggle.disabled = Boolean(isHero);
    }
    if (focusControls) {
      if (isHero) {
        focusControls.removeAttribute("hidden");
      } else {
        focusControls.setAttribute("hidden", "hidden");
      }
    }
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
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data = await res.json();
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
    __idx: idx,
  }));

  window.adminProjectsCache = normalized;
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

  window.adminProjectsDisplay = sortProjectsBySpotlight([...filtered].reverse());
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
  const { items, totalPages, currentPage } = paginateAdminProjects(display, page);
  window.adminProjectsCurrentPage = currentPage;

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
    const isSpotlight = Boolean(project.spotlight);
    const cardClass = `admin-card${isSpotlight ? " admin-card--spotlight" : ""}`;
    const spotlightChip = isSpotlight ? '<span class="admin-spotlight-chip">Spotlight</span>' : "";
    const toggleLabel = isSpotlight ? "Remove Spotlight" : "Set as Spotlight";
    const toggleValue = isSpotlight ? "false" : "true";
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
      <div class="${cardClass}" data-index="${originalIndex}" data-spotlight="${isSpotlight}" data-status="${status}">
        ${mediaMarkup}
        <div class="admin-info">
          <div class="admin-title">
            <div class="admin-title-heading">
              <h3 style="margin:0">${titleText}</h3>
              ${statusChip}
              ${spotlightChip}
            </div>
            <button class="more-btn" aria-label="More" onclick="toggleCardMenu(event, ${originalIndex})">&#8942;</button>
            <div class="more-menu" id="menu-${originalIndex}">
              <button onclick="openEditModal(${originalIndex})">Edit</button>
              <button onclick="toggleProjectStatus(${originalIndex}, '${statusToggleValue}')">${statusToggleLabel}</button>
              <button onclick="toggleSpotlight(${originalIndex}, ${toggleValue})">${toggleLabel}</button>
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
  renderAdminPagination(pagination, totalPages, currentPage);
}

function renderAdminPagination(container, totalPages, currentPage) {
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
function toggleCardMenu(e, i) {
  e.stopPropagation();
  document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
  const menu = $id(`menu-${i}`);
  if (menu) menu.classList.toggle("open");
}
document.addEventListener("click", () => {
  document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
});

async function toggleSpotlight(index, enable = true) {
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
    fd.append("spotlight", shouldEnable ? "true" : "false");
    const res = await fetch(`/api/projects/${numericIndex}`, {
      method: "PUT",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }

    document.querySelectorAll(".more-menu.open").forEach((m) => m.classList.remove("open"));
    showAdminToast(
      shouldEnable ? "Project spotlight updated." : "Spotlight removed.",
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
    broadcastProjectsUpdate({ action: "spotlight", index: numericIndex, enable: shouldEnable });

    return data;
  } catch (err) {
    console.error("Spotlight toggle error:", err);
    showAdminToast(err.message || "Unable to update spotlight.", "error");
    return null;
  }
}

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

  if (titleInput) titleInput.value = project.title || "";
  if (clientInput) clientInput.value = project.client || "";
  if (descriptionInput) descriptionInput.value = project.description || "";
  if (categoryInput) categoryInput.value = project.category || "";
  if (statusSelect) statusSelect.value = (project.status || "published") === "draft" ? "draft" : "published";
  if (tagsInput) tagsInput.value = Array.isArray(project.tags) ? project.tags.join(", ") : "";

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
    wrapper.innerHTML = `
      ${preview}
      <button type="button" class="media-remove" aria-label="Toggle remove">&times;</button>
      <button type="button" class="media-hero-toggle" data-media-url="${safeUrl}">
        ${isHero ? "Cover Image" : "Set as Cover"}
      </button>
      <div class="media-focus-controls"${isHero ? "" : " hidden"} data-media-url="${safeUrl}">
        <div class="media-focus-row">
          <label>Horizontal</label>
          <input type="range" min="0" max="100" step="1" value="${focusX}" data-focus-axis="x" />
          <span class="media-focus-value" data-focus-value="x">${Math.round(focusX)}%</span>
        </div>
        <div class="media-focus-row">
          <label>Vertical</label>
          <input type="range" min="0" max="100" step="1" value="${focusY}" data-focus-axis="y" />
          <span class="media-focus-value" data-focus-value="y">${Math.round(focusY)}%</span>
        </div>
        <div class="media-focus-row">
          <label>Zoom</label>
          <input type="range" min="100" max="200" step="1" value="${Math.round(
            focusZoom * 100,
          )}" data-focus-axis="zoom" />
          <span class="media-focus-value" data-focus-value="zoom">${Math.round(
            focusZoom * 100,
          )}%</span>
        </div>
        <div class="media-focus-actions">
          <button type="button" class="media-focus-reset">Center</button>
        </div>
      </div>
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
    removeBtn?.addEventListener("click", () => {
      if (wrapper.classList.contains("marked-remove")) {
        unmark();
      } else {
        mark();
      }
    });

    const heroToggle = wrapper.querySelector(".media-hero-toggle");
    heroToggle?.addEventListener("click", () => {
      if (!media.url) return;
      setHeroMediaSelection(media.url);
    });

    const focusControls = wrapper.querySelector(".media-focus-controls");
    const previewEl = wrapper.querySelector(".media-preview");
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
      focusControls.querySelector(".media-focus-reset")?.addEventListener("click", () => {
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

    const payload = {
      title: (formData.get("title") || "").toString().trim(),
      client: (formData.get("client") || "").toString().trim(),
      description: (formData.get("description") || "").toString().trim(),
      category: (formData.get("category") || "").toString().trim(),
      media: uploadedMedia,
      status,
      tags,
      spotlight: false,
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
  const statusValue = statusSelect ? statusSelect.value : "published";
  const normalizedStatus = statusValue === "draft" ? "draft" : "published";
  const tags = parseTagsInput(tagsInput?.value || "");

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
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
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

/************ INIT ************/
/************ INIT ************/
document.addEventListener("DOMContentLoaded", async () => {
  setupProjectsSync();
  setupModalInteractions();
  applySectionObserver();
  initHeroParallax();
  setupHeroBlend();
  initCtaBanner();

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

// @ts-nocheck
/************ PUBLIC (index.html) ************/
const VIDEO_THUMB_FALLBACK = "/static/default-video-thumb.jpg";
const PROJECTS_PER_PAGE = 12;
const DEFAULT_PROJECT_CATEGORY = "General";
const ADMIN_PROJECTS_PER_PAGE = PROJECTS_PER_PAGE;
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
  if (!media) return VIDEO_THUMB_FALLBACK;
  if (typeof media.thumbnail === "string" && media.thumbnail.trim()) return media.thumbnail;
  if (media.type === "video") return VIDEO_THUMB_FALLBACK;
  if (typeof media.url === "string" && media.url.trim()) return media.url;
  return VIDEO_THUMB_FALLBACK;
}

function normalizeShareFileName(title) {
  if (typeof title !== "string" || !title.trim()) return "movil-project";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "movil-project";
}

function buildProjectShareId(project, index) {
  const idx = Number.isInteger(index) ? index : Number.parseInt(index, 10);
  const safeIndex = Number.isInteger(idx) && idx >= 0 ? idx : 0;
  const baseSlug = normalizeShareFileName(project?.title || "");
  return `${safeIndex}-${baseSlug}`;
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
}

function broadcastProjectsUpdate(detail = {}) {
  if (typeof window === "undefined") return;
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
    const normalized = [...rawProjects]
      .map((project) => {
        const normalized = {
          ...project,
          media: Array.isArray(project.media) ? project.media : [],
        };
        normalized.category = normalizeCategory(normalized.category);
        normalized.description =
          typeof normalized.description === "string"
            ? normalized.description
            : "";
        normalized.client =
          typeof project.client === "string" ? project.client.trim() : "";
        normalized.spotlight = Boolean(project.spotlight);
        return normalized;
      })
      .reverse();

    const prioritized = sortProjectsBySpotlight(normalized);

    prioritized.forEach((p, idx) => {
      p.__idx = idx;
      p.spotlight = Boolean(p.spotlight);
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

    const filteredCount = getFilteredProjects().length || 0;
    const totalPages = Math.max(1, Math.ceil(filteredCount / PROJECTS_PER_PAGE));
    const safePage = Math.min(Math.max(requestedPage, 1), totalPages);
    window.publicProjectsCurrentPage = safePage;
    renderPublicProjectsPage(safePage);
  } catch (err) {
    console.error("Failed to load projects:", err);
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
      const projectIndex = typeof p.__idx === "number" ? p.__idx : offset + idx;
      const delay = Math.min(idx, 6) * 0.07;
      const isFeatured = Boolean(p.spotlight);
      const featuredVideo = isFeatured
        ? mediaItems.find((mediaItem) => mediaItem && mediaItem.type === "video")
        : null;
      const heroMedia = featuredVideo || firstMedia;
      if (!heroMedia) return;

      const heroThumb = getMediaThumb(heroMedia);
      const titleText = escapeHtml(p.title || "Untitled Project");
      const categoryText = escapeHtml(category);
      const clientName =
        typeof p.client === "string" ? p.client.trim() : "";
      const clientHtml = clientName
        ? `<p class="project-card-client">Client: ${escapeHtml(clientName)}</p>`
        : "";
      const snippetHtml = snippetText ? `<p class="project-card-desc">${escapeHtml(snippetText)}</p>` : "";
      const shareHtml = `
        <div class="project-card-actions">
          <button type="button" class="project-card-share" onclick="shareProject(event, ${projectIndex})" aria-label="Share ${titleText}">
            <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
            <span>Share</span>
          </button>
        </div>
      `;
      const altText = escapeHtml(`${p.title || "Project"} showcase`);
      const heroMediaIndex = mediaItems.indexOf(heroMedia);
      const safeMediaIndex = heroMediaIndex >= 0 ? heroMediaIndex : 0;

    let mediaTag = "";
    if (featuredVideo) {
      mediaTag = `
        <video src="${featuredVideo.url}" poster="${heroThumb}" muted playsinline loop preload="metadata" data-autoplay="1" aria-label="${altText}"></video>
      `;
    } else if (heroMedia.type === "video") {
      mediaTag = `
        <div class="video-thumb">
          <img src="${heroThumb}" alt="${altText}" loading="lazy">
          <span class="play-icon" aria-hidden="true">&#9658;</span>
        </div>
      `;
    } else {
      mediaTag = `<img src="${heroThumb}" alt="${altText}" loading="lazy">`;
    }

    const badgeHtml = isFeatured ? '<span class="project-card-badge">Spotlight</span>' : "";
    const cardClass = `project-card ${isFeatured ? "project-card--featured" : ""}`.trim();
    grid.insertAdjacentHTML(
      "beforeend",
      `
      <div class="${cardClass}" id="project-${projectIndex}" data-index="${projectIndex}" data-media-index="${safeMediaIndex}" style="--card-delay:${delay}s" onclick="openModal(${projectIndex},${safeMediaIndex})">
        <div class="project-card-media">
          ${mediaTag}
        </div>
        <div class="project-card-meta">
          ${badgeHtml}
          <span class="project-card-category">${categoryText}</span>
          <h3>${titleText}</h3>
          ${clientHtml}
          ${snippetHtml}
          ${shareHtml}
        </div>
      </div>
    `
    );
  });

  attachFallbacks(grid);
  applyProjectCardObserver(grid);
  applyFeaturedMediaObserver(grid);

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
  if (!hash.startsWith("#project-")) return;
  const raw = hash.replace("#project-", "");
  const numericIndex = Number.parseInt(raw, 10);
  if (!Number.isFinite(numericIndex)) return;

  const card = document.getElementById(`project-${numericIndex}`);
  if (!card) return;
  const mediaIndex = Number.parseInt(card.getAttribute("data-media-index") || "0", 10) || 0;
  requestAnimationFrame(() => openModal(numericIndex, mediaIndex));
}

async function shareProject(event, projectIndex) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const projects = Array.isArray(window.publicProjectsCache) ? window.publicProjectsCache : [];
  const project = projects[projectIndex];
  if (!project) return;

  const origin =
    window.location?.origin ||
    `${window.location?.protocol || ""}//${window.location?.host || ""}`;
  const shareId = buildProjectShareId(project, projectIndex);
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

function openModal(projectIndex, mediaIndex) {
  currentProjectIndex = projectIndex;
  currentMediaIndex = mediaIndex;
  renderModal();

  const modal = document.getElementById("projectModal");
  lockBodyScroll();
  modal.style.display = "flex"; // make it visible first
  requestAnimationFrame(() => modal.classList.add("show")); // trigger fade-in

  if (typeof window !== "undefined" && window.history?.replaceState) {
    const newUrl =
      `${window.location.pathname}${window.location.search}#project-${projectIndex}`;
    window.history.replaceState(null, "", newUrl);
  } else if (typeof window !== "undefined") {
    window.location.hash = `project-${projectIndex}`;
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
        <span class="modal-watermark">c Movil</span>
        <img src="${media.url}" alt="${p.title}" class="modal-img modal-media-el">
      </div>`;
  } else {
    modalMedia.innerHTML = `
      <div class="modal-media-wrapper">
        <span class="modal-watermark">c Movil</span>
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

/**************** FETCH ****************/
async function fetchAllProjects() {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
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
    __idx: idx,
  }));

  window.adminProjectsCache = normalized;
  window.adminProjectsDisplay = sortProjectsBySpotlight([...normalized].reverse());
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

    const mediaMarkup = first?.type === "video"
      ? `<video src="${first.url}" poster="${thumb}" muted playsinline></video>`
      : `<img src="${thumb}" alt="${titleText}">`;

    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="${cardClass}" data-index="${originalIndex}" data-spotlight="${isSpotlight}">
        ${mediaMarkup}
        <div class="admin-info">
          <div class="admin-title">
            <div class="admin-title-heading">
              <h3 style="margin:0">${titleText}</h3>
              ${spotlightChip}
            </div>
            <button class="more-btn" aria-label="More" onclick="toggleCardMenu(event, ${originalIndex})">&#8942;</button>
            <div class="more-menu" id="menu-${originalIndex}">
              <button onclick="openEditModal(${originalIndex})">Edit</button>
              <button onclick="toggleSpotlight(${originalIndex}, ${toggleValue})">${toggleLabel}</button>
              <button onclick="deleteProject(${originalIndex})">Delete</button>
            </div>
          </div>
          <span class="project-card-category">${categoryText}</span>
          ${clientText}
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

async function postSpotlight(url, payload) {
  const res = await fetch(url, {
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
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.response = data;
    throw error;
  }
  return data;
}

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
    let response;
    try {
      response = await postSpotlight(`/api/projects/${numericIndex}/spotlight`, {
        spotlight: shouldEnable,
      });
    } catch (error) {
      if (error.status === 404) {
        try {
          response = await postSpotlight(`/api/projects/spotlight`, {
            index: numericIndex,
            spotlight: shouldEnable,
          });
        } catch (fallbackError) {
          if (fallbackError.status === 404 || fallbackError.status === 405 || fallbackError.status === 500) {
            response = await updateSpotlightViaEdit(numericIndex, shouldEnable);
          } else {
            throw fallbackError;
          }
        }
      } else if (error.status === 405 || error.status === 500) {
        response = await updateSpotlightViaEdit(numericIndex, shouldEnable);
      } else {
        throw error;
      }
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

    return response;
  } catch (err) {
    console.error("Spotlight toggle error:", err);
    showAdminToast(err.message || "Unable to update spotlight.", "error");
    return null;
  }
}

async function updateSpotlightViaEdit(index, enable) {
  const fd = new FormData();
  fd.append("spotlight", enable ? "true" : "false");
  const res = await fetch(`/api/projects/${index}`, {
    method: "PUT",
    body: fd,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok || !data?.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/************ ADMIN: UPLOAD ************/
$id("uploadForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const categoryInput = form.querySelector('[name="category"]');
  const categoryValue =
    typeof categoryInput?.value === "string" ? categoryInput.value.trim() : "";
  formData.set("category", categoryValue);
  const clientInput = form.querySelector('[name="client"]');
  const clientValue =
    typeof clientInput?.value === "string" ? clientInput.value.trim() : "";
  formData.set("client", clientValue);
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
    submitBtn.textContent = isSubmitting ? "Uploading…" : "Upload Project";
  };

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/projects");
  setSubmittingState(true);
  setProgress(6);

  xhr.upload.addEventListener("progress", (evt) => {
    if (evt.lengthComputable) {
      const pct = (evt.loaded / evt.total) * 100;
      setProgress(Math.max(12, pct));
    } else {
      setProgress(25);
    }
  });

  xhr.onreadystatechange = () => {
    if (xhr.readyState !== XMLHttpRequest.DONE) return;

    setProgress(100);
    setSubmittingState(false);

    let data = {};
    try {
      data = JSON.parse(xhr.responseText || "{}");
    } catch (_) {
      data = { ok: false, error: "Unexpected response from server" };
    }

    if (xhr.status >= 200 && xhr.status < 300 && data?.ok) {
      form.reset();
      showAdminToast("Project uploaded successfully!", "success");
      loadAdminProjects(1)
        .then(() => {
          if (window.loadPublicProjects) {
            return loadPublicProjects(1);
          }
          return null;
        })
        .catch((err) => {
          console.error(err);
          showAdminToast("Project list refresh failed. Please reload.", "error");
        })
        .finally(() => {
          broadcastProjectsUpdate({ action: "upload" });
          resetProgress();
        });
    } else {
      const errorMessage =
        data?.error ||
        xhr.statusText ||
        "Upload failed. Please try again.";
      console.error("Upload error:", errorMessage);
      showAdminToast(errorMessage, "error");
      resetProgress();
    }
  };

  xhr.onerror = () => {
    setSubmittingState(false);
    showAdminToast("Network error during upload. Please try again.", "error");
    resetProgress();
  };

  xhr.send(formData);
});

/************ ADMIN: EDIT ************/
function openEditModal(index) {
  currentEditIndex = index;
  removedMedia = [];

  const p = window.adminProjectsCache[index];
  if (!p) return;

  $id("editTitle").value = p.title || "";
  const clientField = $id("editClient");
  if (clientField) clientField.value = p.client || "";
  $id("editDescription").value = p.description || "";
  $id("editCategory").value = p.category || DEFAULT_PROJECT_CATEGORY;

  renderEditMediaList(p.media || []);

  const modal = $id("editModal");
  if (!modal) return;
  modal.style.display = "flex";
  requestAnimationFrame(() => modal.classList.add("show"));
}

function renderEditMediaList(media) {
  const list = $id("editMediaList");
  list.innerHTML = "";

  (media || []).forEach((m) => {
    const isVideo = m.type === "video";
    const thumb = getMediaThumb(m);
    const dataUrl = escapeHtml(m.url || "");
    const dataThumb = escapeHtml(m.thumbnail || "");
    const dataCloudinaryId = escapeHtml(m.cloudinaryId || "");
    const dataType = escapeHtml(m.type || "");
    const dataResourceType = escapeHtml(m.cloudinaryResourceType || (m.type === "video" ? "video" : "image"));
    const mediaMarkup = isVideo
      ? `<video src="${escapeHtml(m.url || "")}" poster="${escapeHtml(thumb)}" muted playsinline></video>`
      : `<img src="${escapeHtml(thumb)}" alt="media" loading="lazy">`;

    list.insertAdjacentHTML(
      "beforeend",
      `
      <div class="media-item"
           data-url="${dataUrl}"
           data-thumbnail="${dataThumb}"
           data-cloudinary-id="${dataCloudinaryId}"
           data-type="${dataType}"
           data-resource-type="${dataResourceType}">
        ${mediaMarkup}
        <button class="media-remove" title="Remove" onclick="handleRemoveExistingMedia(this)">&times;</button>
      </div>
    `
    );
  });
  attachFallbacks(list);
}

function handleRemoveExistingMedia(button) {
  const item = button?.closest(".media-item");
  if (!item) return;
  removeExistingMedia(
    item.dataset.url || "",
    item.dataset.thumbnail || "",
    item.dataset.cloudinaryId || "",
    item.dataset.type || "",
    item.dataset.resourceType || "",
    item
  );
}

function removeExistingMedia(
  url,
  thumbnail = "",
  cloudinaryId = "",
  mediaType = "",
  cloudinaryResourceType = "",
  element
) {
  removedMedia.push({ url, thumbnail, cloudinaryId, type: mediaType, cloudinaryResourceType });
  if (element) {
    element.remove();
    return;
  }
  const item = document.querySelector(`.media-item[data-url="${CSS.escape(url)}"]`);
  if (item) item.remove();
}

function closeEditModal() {
  const modal = $id("editModal");
  if (!modal) return;
  modal.classList.remove("show");
  setTimeout(() => {
    modal.style.display = "none";
  }, 350);
  removedMedia = [];
  currentEditIndex = null;
}

/************ ADMIN: SAVE EDIT ************/
document.getElementById("editForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentEditIndex === null) return;

  const editedIndex = currentEditIndex;
  const title = document.getElementById("editTitle").value.trim();
  const client = document.getElementById("editClient")?.value.trim() || "";
  const description = document.getElementById("editDescription").value.trim();
  const category = document.getElementById("editCategory").value.trim();

  // OK Create FormData safely
  const fd = new FormData();
  fd.append("title", title || "");
  fd.append("client", client);
  fd.append("description", description || "");
  fd.append("category", category || "");
  fd.append("removed", JSON.stringify(Array.isArray(removedMedia) ? removedMedia : []));

  // OK Add new uploads if any
  const newFiles = document.getElementById("editNewMedia")?.files || [];
  [...newFiles].forEach((f) => fd.append("newMedia", f));

  try {
    // OK Send PUT request
    const res = await fetch(`/api/projects/${currentEditIndex}`, {
      method: "PUT",
      body: fd,
    });

    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Edit failed");

    alert("Changes saved successfully!");
    closeEditModal();

    // OK Refresh admin project list
    await loadAdminProjects(window.adminProjectsCurrentPage || 1);

    // OK Also refresh public gallery if available
    if (window.loadPublicProjects) {
      try {
        await loadPublicProjects();
      } catch (refreshErr) {
        console.error("Public gallery refresh failed:", refreshErr);
      }
    }
    broadcastProjectsUpdate({ action: "edit", index: editedIndex });
  } catch (err) {
    console.error("Edit error:", err);
    alert("Error: " + (err.message || "Something went wrong while saving changes"));
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
  setupHeroBlend();
  initCtaBanner();

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
    await loadAdminProjects(1).catch(console.error);
  }

  // Modal close for admin
  window.addEventListener("click", (e) => {
    const modal = document.getElementById("editModal");
    if (e.target === modal) closeEditModal();
  });
});

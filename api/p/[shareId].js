import { withErrorHandling, notFound } from "../../lib/http.js";
import { getProjects, getSharePageMeta } from "../../lib/projects.js";
import { buildShareId, buildShareKey, slugify } from "../../lib/utils.js";

export default withErrorHandling(async function handler(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    return res.end("Method Not Allowed");
  }
  const isHeadRequest = method === "HEAD";

  const rawShareId = req.query?.shareId;
  if (!rawShareId) return notFound(res);

  const shareId = String(rawShareId).trim();
  if (!shareId) return notFound(res);

  const projects = await getProjects();
  const [keyPartRaw, ...slugParts] = shareId.split("-");
  const keyPart = keyPartRaw || "";
  const slugPart = slugParts.join("-") || "";

  let matchIndex = -1;

  for (let idx = 0; idx < projects.length; idx += 1) {
    const candidate = projects[idx];
    if (buildShareId(candidate, idx) === shareId) {
      matchIndex = idx;
      break;
    }
  }

  if (matchIndex === -1 && /^\d+$/.test(keyPart)) {
    const idx = Number.parseInt(keyPart, 10);
    if (idx >= 0 && idx < projects.length) {
      const candidate = projects[idx];
      if (!slugPart || slugify(candidate?.title || "") === slugPart) {
        matchIndex = idx;
      }
    }
  }

  if (matchIndex === -1 && /^i\d+$/i.test(keyPart)) {
    const idx = Number.parseInt(keyPart.slice(1), 10);
    if (idx >= 0 && idx < projects.length) {
      const candidate = projects[idx];
      if (!slugPart || slugify(candidate?.title || "") === slugPart) {
        matchIndex = idx;
      }
    }
  }

  if (matchIndex === -1 && keyPart) {
    matchIndex = projects.findIndex((project, idx) => buildShareKey(project, idx) === keyPart);
  }

  if (matchIndex === -1 && slugPart) {
    matchIndex = projects.findIndex((project) => slugify(project?.title || "") === slugPart);
  }

  if (matchIndex === -1) {
    return notFound(res);
  }

  const project = projects[matchIndex];
  const canonicalId = buildShareId(project, matchIndex);
  if (canonicalId !== shareId) {
    res.statusCode = 302;
    res.setHeader("Location", `/p/${canonicalId}`);
    return res.end();
  }

  const meta = getSharePageMeta(project, matchIndex);
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin) {
    meta.canonicalUrl = new URL(`/p/${canonicalId}`, requestOrigin).toString();
    meta.imageUrl = ensureAbsoluteUrl(meta.imageUrl, requestOrigin);
  }

  const html = buildDetailHtml(meta, project);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(html));
  if (isHeadRequest) {
    return res.end();
  }
  res.end(html);
});

function buildDetailHtml(meta, project) {
  const heroMarkup = renderHero(project, meta);
  const descriptionMarkup = renderDescription(project.description);
  const client = project.client
    ? `<p class="detail-client">Client: ${escapeHtml(project.client)}</p>`
    : "";
  const category = project.category
    ? `<span class="detail-category">${escapeHtml(project.category)}</span>`
    : "";
  const tags = Array.isArray(project.tags) && project.tags.length
    ? `<ul class="detail-tags">${project.tags
        .slice(0, 8)
        .map((tag) => `<li>${escapeHtml(tag)}</li>`)
        .join("")}</ul>`
    : "";
  const galleryHtml = renderGallery(project.media || [], meta.title);
  const shareUrlJson = JSON.stringify(meta.canonicalUrl);
  const pageTitle = escapeHtml(meta.title);
  const encodedUrl = encodeURIComponent(meta.canonicalUrl);
  const encodedTitle = encodeURIComponent(meta.title);
  const shareLinks = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    whatsapp: `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
  };
  const shareSnippet = escapeHtml(meta.description.slice(0, 140));
  const shareTitleJson = JSON.stringify(meta.title);
  const shareTextJson = JSON.stringify(shareSnippet);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle} | Movil</title>
    <link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Movil" />
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />
    <meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${pageTitle}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}" />
    <style>
      :root {
        color-scheme: dark;
        font-family: "Poppins", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --detail-bg: radial-gradient(circle at top, #040614, #02030a 70%);
        --detail-card: rgba(15, 17, 29, 0.92);
        --detail-border: rgba(255, 255, 255, 0.09);
        --accent: #08af8a;
        --accent-rgb: 8, 175, 138;
        --primary-rgb: 54, 76, 177;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--detail-bg);
        color: #f5f6fa;
      }
      main {
        width: min(1100px, 94vw);
        margin: 0 auto;
        padding: clamp(32px, 6vw, 70px) 0 90px;
        display: flex;
        flex-direction: column;
        gap: clamp(32px, 5vw, 60px);
      }
      .project-detail__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
      }
      .detail-back {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        font-size: 0.92rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(245, 246, 250, 0.85);
      }
      .detail-category {
        padding: 6px 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.75rem;
      }
      .detail-hero {
        border-radius: 26px;
        border: 1px solid var(--detail-border);
        overflow: hidden;
        box-shadow: 0 32px 60px rgba(3, 3, 10, 0.45);
      }
      .detail-hero img,
      .detail-hero video {
        width: 100%;
        display: block;
        max-height: 560px;
        object-fit: cover;
      }
      .project-detail__info {
        display: grid;
        gap: 24px;
        background: var(--detail-card);
        border-radius: 26px;
        border: 1px solid var(--detail-border);
        padding: clamp(24px, 4vw, 36px);
      }
      .project-detail__info h1 {
        margin: 0;
        font-size: clamp(2.2rem, 4vw, 3rem);
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .detail-description p {
        margin: 0 0 12px;
        color: rgba(245, 246, 250, 0.82);
        line-height: 1.7;
      }
      .detail-client {
        margin: 0;
        font-size: 0.95rem;
        color: rgba(245, 246, 250, 0.8);
        letter-spacing: 0.08em;
      }
      .detail-tags {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .detail-tags li {
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.05);
        text-transform: uppercase;
        font-size: 0.74rem;
        letter-spacing: 0.18em;
      }
      .detail-share {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .detail-share button {
        padding: 12px 22px;
        border-radius: 999px;
        border: 1px solid rgba(var(--accent-rgb), 0.45);
        background: rgba(var(--accent-rgb), 0.18);
        color: #f5f6fa;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .project-detail__gallery {
        display: grid;
        gap: clamp(18px, 3vw, 28px);
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      .detail-media {
        border-radius: 22px;
        border: 1px solid var(--detail-border);
        overflow: hidden;
        background: rgba(0, 0, 0, 0.5);
        aspect-ratio: 4 / 3;
        cursor: zoom-in;
        position: relative;
      }
      .detail-media img,
      .detail-media video {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
      }
      .detail-empty {
        margin: 0;
        color: rgba(245, 246, 250, 0.7);
      }
      .detail-lightbox {
        position: fixed;
        inset: 0;
        background: rgba(2, 3, 8, 0.92);
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 24px;
        z-index: 9999;
        backdrop-filter: blur(12px);
      }
      .detail-lightbox[hidden] {
        display: none;
      }
      .detail-lightbox__content img,
      .detail-lightbox__content video {
        max-width: min(90vw, 1200px);
        max-height: 88vh;
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #000;
      }
      .detail-lightbox__close {
        position: absolute;
        top: 18px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        font-size: 2.8rem;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.25);
        color: #fff;
        cursor: pointer;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s ease, background 0.2s ease;
      }
      .detail-lightbox__close:hover {
        background: rgba(0, 0, 0, 0.75);
        transform: scale(1.05);
      }
      .detail-lightbox__nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 54px;
        height: 54px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        font-size: 2rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .detail-lightbox__nav:hover {
        background: rgba(0, 0, 0, 0.78);
        transform: translateY(-50%) scale(1.05);
      }
      .detail-lightbox__prev {
        left: 24px;
      }
      .detail-lightbox__next {
        right: 24px;
      }
      body.detail-lightbox--open {
        overflow: hidden;
      }
      @media (max-width: 640px) {
        .detail-hero img,
        .detail-hero video {
          max-height: 420px;
        }
        .detail-share button {
          width: 100%;
          text-align: center;
        }
        .detail-lightbox__close {
          width: 48px;
          height: 48px;
          font-size: 2.4rem;
        }
        .detail-lightbox__nav {
          width: 44px;
          height: 44px;
          font-size: 1.6rem;
        }
        .detail-lightbox__prev {
          left: 12px;
        }
        .detail-lightbox__next {
          right: 12px;
        }
      }
    </style>
  </head>
  <body>
    <main class="project-detail">
      <div class="project-detail__header">
        <a class="detail-back" href="/" aria-label="Back to projects">
          <span aria-hidden="true">←</span>
          Back to Projects
        </a>
        ${category}
      </div>
      <div class="detail-hero" aria-label="${pageTitle}">
        ${heroMarkup}
      </div>
      <section class="project-detail__info">
        <h1>${pageTitle}</h1>
        ${client}
        ${descriptionMarkup}
        ${tags}
        <div class="detail-share">
          <button id="detailShareBtn">Share Project</button>
        </div>
      </section>
      <section class="project-detail__gallery">
        ${galleryHtml}
      </section>
    </main>
    <div class="detail-lightbox" id="detailLightbox" hidden>
      <button class="detail-lightbox__close" type="button" aria-label="Close media preview">&times;</button>
      <button class="detail-lightbox__nav detail-lightbox__prev" type="button" aria-label="View previous media">&#10094;</button>
      <button class="detail-lightbox__nav detail-lightbox__next" type="button" aria-label="View next media">&#10095;</button>
      <div class="detail-lightbox__content"></div>
    </div>
    <script>
      (function () {
        var btn = document.getElementById("detailShareBtn");
        if (!btn) return;
        var shareUrl = ${shareUrlJson};
        var shareTitle = ${shareTitleJson};
        var shareText = ${shareTextJson};
        btn.addEventListener("click", function () {
          if (navigator.share) {
            navigator
              .share({
                title: shareTitle,
                text: shareText,
                url: shareUrl,
              })
              .catch(function () {});
            return;
          }
          var temp = document.createElement("input");
          temp.value = shareUrl;
          document.body.appendChild(temp);
          temp.select();
          document.execCommand("copy");
          document.body.removeChild(temp);
          btn.textContent = "Link Copied!";
          setTimeout(function () {
            btn.textContent = "Share Project";
          }, 2400);
        });
      })();
      (function () {
        var lightbox = document.getElementById("detailLightbox");
        if (!lightbox) return;
        var content = lightbox.querySelector(".detail-lightbox__content");
        var closeBtn = lightbox.querySelector(".detail-lightbox__close");
        var prevBtn = lightbox.querySelector(".detail-lightbox__prev");
        var nextBtn = lightbox.querySelector(".detail-lightbox__next");
        var mediaItems = Array.prototype.slice.call(document.querySelectorAll(".detail-media"));
        var currentIndex = -1;

        function openAt(index) {
          if (!mediaItems.length) return;
          if (index < 0) index = mediaItems.length - 1;
          if (index >= mediaItems.length) index = 0;
          currentIndex = index;
          var node = mediaItems[currentIndex];
          if (!node) return;
          var type = node.getAttribute("data-type");
          var full = node.getAttribute("data-full");
          var alt = node.getAttribute("data-alt") || "Project media full view";
          if (!full) return;
          document.body.classList.add("detail-lightbox--open");
          lightbox.hidden = false;
          if (type === "video") {
            content.innerHTML =
              '<video controls autoplay playsinline muted src="' + full + '"></video>';
          } else {
            content.innerHTML = '<img src="' + full + '" alt="' + alt + '">';
          }
        }

        function closeLightbox() {
          lightbox.hidden = true;
          content.innerHTML = "";
          document.body.classList.remove("detail-lightbox--open");
          currentIndex = -1;
        }

        mediaItems.forEach(function (node, idx) {
          node.addEventListener("click", function () {
            var attrIdx = Number.parseInt(node.getAttribute("data-index"), 10);
            openAt(Number.isNaN(attrIdx) ? idx : attrIdx);
          });
        });

        function showPrevious() {
          if (currentIndex === -1) return;
          openAt(currentIndex - 1);
        }

        function showNext() {
          if (currentIndex === -1) return;
          openAt(currentIndex + 1);
        }

        closeBtn?.addEventListener("click", closeLightbox);
        prevBtn?.addEventListener("click", function (event) {
          event.stopPropagation();
          showPrevious();
        });
        nextBtn?.addEventListener("click", function (event) {
          event.stopPropagation();
          showNext();
        });

        lightbox.addEventListener("click", function (event) {
          if (event.target === lightbox) closeLightbox();
        });

        document.addEventListener("keydown", function (event) {
          if (lightbox.hidden) return;
          if (event.key === "Escape") {
            closeLightbox();
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            showPrevious();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            showNext();
          }
        });
      })();
    </script>
  </body>
</html>`;
}

function getRequestOrigin(req) {
  if (!req || !req.headers) return "";
  const proto =
    (req.headers["x-forwarded-proto"] || req.headers["X-Forwarded-Proto"] || "")
      .toString()
      .split(",")[0]
      .trim() || (req.connection && req.connection.encrypted ? "https" : "http");
  const hostHeader =
    req.headers["x-forwarded-host"] ||
    req.headers["X-Forwarded-Host"] ||
    req.headers.host ||
    req.headers.Host ||
    "";
  const host = hostHeader.toString().split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

function ensureAbsoluteUrl(value, origin) {
  if (!value) return value;
  try {
    const parsed = new URL(value, origin);
    return parsed.toString();
  } catch {
    return value;
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHero(project, meta) {
  const media = selectPrimaryMedia(project);
  if (!media) {
    return `<img src="${escapeHtml(meta.imageUrl)}" alt="${escapeHtml(meta.title)}">`;
  }
  const focusAttr = buildFocusStyleAttr(media);
  if ((media.type || "").toLowerCase() === "video") {
    const poster = escapeHtml(media.thumbnail || media.url || meta.imageUrl);
    return `<video controls playsinline muted poster="${poster}" src="${escapeHtml(media.url)}"${focusAttr}></video>`;
  }
  return `<img src="${escapeHtml(media.url || meta.imageUrl)}" alt="${escapeHtml(meta.title)}"${focusAttr}>`;
}

function renderDescription(description = "") {
  const text = String(description || "").trim();
  if (!text) return "";
  const paragraphs = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "";
  return `<div class="detail-description">${paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("")}</div>`;
}

function renderGallery(mediaList, title = "Project media") {
  if (!Array.isArray(mediaList) || !mediaList.length) {
    return '<p class="detail-empty">Media will be available soon.</p>';
  }
  return mediaList.map((media, idx) => renderMediaFigure(media, idx, title)).join("");
}

function renderMediaFigure(media, idx, title) {
  if (!media || !media.url) return "";
  const alt = escapeHtml(`${title} media ${idx + 1}`);
  if ((media.type || "").toLowerCase() === "video") {
    const poster = escapeHtml(media.thumbnail || media.url);
    return `<figure class="detail-media detail-media--video" data-type="video" data-full="${escapeHtml(
      media.url
    )}" data-index="${idx}" data-alt="${alt}">
      <video controls playsinline muted poster="${poster}" src="${escapeHtml(media.url)}"${buildFocusStyleAttr(
        media
      )}></video>
    </figure>`;
  }
  return `<figure class="detail-media detail-media--image" data-type="image" data-full="${escapeHtml(
    media.url
  )}" data-index="${idx}" data-alt="${alt}">
    <img src="${escapeHtml(media.url)}" loading="lazy" alt="${alt}"${buildFocusStyleAttr(media)}>
  </figure>`;
}

function clampFocusValue(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function buildFocusStyleAttr(media) {
  if (!media || typeof media !== "object") return "";
  const focus = media.focus;
  if (!focus || typeof focus !== "object") return "";
  const x = clampFocusValue(Number(focus.x));
  const y = clampFocusValue(Number(focus.y));
  if (x === null && y === null) return "";
  const posX = x === null ? 50 : x;
  const posY = y === null ? 50 : y;
  return ` style="object-position: ${posX}% ${posY}%;"`;
}

function selectPrimaryMedia(project) {
  const mediaList = Array.isArray(project?.media)
    ? project.media.filter((entry) => entry && (entry.thumbnail || entry.url))
    : [];
  if (!mediaList.length) return null;
  const heroUrl = typeof project?.heroMediaUrl === "string" ? project.heroMediaUrl.trim() : "";
  if (heroUrl) {
    const heroMedia = mediaList.find((entry) => entry?.url === heroUrl);
    if (heroMedia) return heroMedia;
  }
  const firstImage = mediaList.find((entry) => (entry.type || "").toLowerCase() !== "video");
  if (firstImage) return firstImage;
  const firstThumb = mediaList.find((entry) => entry.thumbnail);
  if (firstThumb) return firstThumb;
  return mediaList[0];
}

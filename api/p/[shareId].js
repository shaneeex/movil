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
  const gallery = renderGallery(project.media || [], meta.title);
  const shareUrlJson = JSON.stringify(meta.canonicalUrl);
  const shareUrlText = escapeHtml(meta.canonicalUrl);
  const pageTitle = escapeHtml(meta.title);

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
        --detail-bg: radial-gradient(circle at top, #0a0c1a, #04050b 70%);
        --detail-card: rgba(14, 16, 28, 0.82);
        --detail-border: rgba(255, 255, 255, 0.08);
        --accent: #08af8a;
        --accent-rgb: 8, 175, 138;
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
        padding: clamp(32px, 5vw, 56px) 0 80px;
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
        color: rgba(245, 246, 250, 0.8);
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
        margin-top: 28px;
        border-radius: 24px;
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
      .project-detail__body {
        margin-top: clamp(28px, 5vw, 48px);
        display: grid;
        gap: clamp(24px, 4vw, 40px);
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }
      .detail-info {
        background: var(--detail-card);
        border-radius: 24px;
        border: 1px solid var(--detail-border);
        padding: clamp(20px, 3vw, 32px);
        display: grid;
        gap: 18px;
      }
      .detail-info h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 2.8rem);
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .detail-description p {
        margin: 0 0 12px 0;
        color: rgba(245, 246, 250, 0.82);
        line-height: 1.7;
      }
      .detail-client {
        margin: 0;
        font-size: 0.95rem;
        color: rgba(245, 246, 250, 0.85);
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
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
      }
      .detail-share button {
        padding: 10px 18px;
        border-radius: 999px;
        border: 1px solid rgba(var(--accent-rgb), 0.5);
        background: rgba(var(--accent-rgb), 0.18);
        color: #f5f6fa;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        cursor: pointer;
      }
      .detail-share-hint {
        font-size: 0.8rem;
        color: rgba(245, 246, 250, 0.6);
      }
      .project-detail__gallery {
        display: grid;
        gap: 18px;
      }
      .detail-media {
        border-radius: 20px;
        border: 1px solid var(--detail-border);
        overflow: hidden;
        background: rgba(0, 0, 0, 0.4);
      }
      .detail-media img,
      .detail-media video {
        width: 100%;
        display: block;
        object-fit: cover;
      }
      .detail-empty {
        margin: 0;
        color: rgba(245, 246, 250, 0.7);
      }
      @media (max-width: 640px) {
        .detail-hero img,
        .detail-hero video {
          max-height: 420px;
        }
      }
    </style>
  </head>
  <body>
    <main class="project-detail">
      <div class="project-detail__header">
        <a class="detail-back" href="/">
          <span aria-hidden="true">←</span>
          Back to Projects
        </a>
        ${category}
      </div>
      <div class="detail-hero" aria-label="${pageTitle}">
        ${heroMarkup}
      </div>
      <section class="project-detail__body">
        <article class="detail-info">
          <h1>${pageTitle}</h1>
          ${client}
          ${descriptionMarkup}
          ${tags}
          <div class="detail-share">
            <button id="detailShareBtn">Copy share link</button>
            <span class="detail-share-hint">${shareUrlText}</span>
          </div>
        </article>
        <div class="project-detail__gallery">
          ${gallery}
        </div>
      </section>
    </main>
    <script>
      (function () {
        var btn = document.getElementById("detailShareBtn");
        if (!btn) return;
        var shareUrl = ${shareUrlJson};
        btn.addEventListener("click", function () {
          var copier = function () {
            btn.textContent = "Link copied!";
            setTimeout(function () {
              btn.textContent = "Copy share link";
            }, 2400);
          };
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(copier);
            return;
          }
          var temp = document.createElement("input");
          temp.value = shareUrl;
          document.body.appendChild(temp);
          temp.select();
          document.execCommand("copy");
          document.body.removeChild(temp);
          copier();
        });
      })();
    </script>
  </body>
</html>`;
}

function renderHero(project, meta) {
  const media = selectPrimaryMedia(project);
  if (!media) {
    return `<img src="${escapeHtml(meta.imageUrl)}" alt="${escapeHtml(meta.title)}">`;
  }
  if ((media.type || "").toLowerCase() === "video") {
    const poster = escapeHtml(media.thumbnail || media.url || meta.imageUrl);
    return `<video controls playsinline poster="${poster}" src="${escapeHtml(media.url)}"></video>`;
  }
  return `<img src="${escapeHtml(media.url || meta.imageUrl)}" alt="${escapeHtml(meta.title)}">`;
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
    return `<figure class="detail-media detail-media--video">
      <video controls playsinline poster="${poster}" src="${escapeHtml(media.url)}"></video>
    </figure>`;
  }
  return `<figure class="detail-media detail-media--image">
    <img src="${escapeHtml(media.url)}" loading="lazy" alt="${alt}">
  </figure>`;
}

function selectPrimaryMedia(project) {
  const mediaList = Array.isArray(project?.media)
    ? project.media.filter((entry) => entry && (entry.thumbnail || entry.url))
    : [];
  if (!mediaList.length) return null;
  const firstImage = mediaList.find((entry) => (entry.type || "").toLowerCase() !== "video");
  if (firstImage) return firstImage;
  const firstThumb = mediaList.find((entry) => entry.thumbnail);
  if (firstThumb) return firstThumb;
  return mediaList[0];
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

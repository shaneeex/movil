
import { withErrorHandling, notFound } from "../../lib/http.js";
import { getProjects, getSharePageMeta } from "../../lib/projects.js";
import { buildShareId, buildShareKey, slugify } from "../../lib/utils.js";

export default withErrorHandling(async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end("Method Not Allowed");
  }

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

  const redirectHash = `/#share-${canonicalId}`;
  const redirectScriptTarget = JSON.stringify(redirectHash);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(meta.title)} | Movil</title>
    <link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Movil" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />
    <meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <meta name="twitter:image" content="${escapeHtml(meta.imageUrl)}" />
    <style>
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 48px 24px;
        display: grid;
        place-items: center;
        min-height: 100vh;
        background: #0b0c14;
        color: #f5f6fa;
        text-align: center;
      }
      a {
        color: #ffd166;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(meta.title)}</h1>
      <p>Redirecting to the featured project...</p>
      <p><a href="${escapeHtml(redirectHash)}">Continue</a></p>
    </main>
    <script>
      (function () {
        var target = ${redirectScriptTarget};
        if (typeof window !== "undefined") {
          try {
            window.location.replace(target);
          } catch (err) {
            window.location.href = target;
          }
        }
      })();
    </script>
  </body>
</html>`);
});

function getRequestOrigin(req) {
  if (!req || !req.headers) return "";
  const proto =
    (req.headers["x-forwarded-proto"] || req.headers["X-Forwarded-Proto"] || "").toString().split(",")[0].trim() ||
    (req.connection && req.connection.encrypted ? "https" : "http");
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


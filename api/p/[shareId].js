
import { withErrorHandling, notFound } from "../../lib/http.js";
import { getProjects, getSharePageMeta } from "../../lib/projects.js";
import { buildShareId } from "../../lib/utils.js";

export default withErrorHandling(async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end("Method Not Allowed");
  }

  const shareId = req.query?.shareId;
  if (!shareId) return notFound(res);

  const projects = await getProjects();
  const [indexPart] = String(shareId).split("-");
  const index = Number.parseInt(indexPart, 10);

  if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
    return notFound(res);
  }

  const project = projects[index];
  const canonicalId = buildShareId(project, index);
  if (canonicalId !== shareId) {
    res.statusCode = 302;
    res.setHeader("Location", `/p/${canonicalId}`);
    return res.end();
  }

  const meta = getSharePageMeta(project, index);
  const redirectHash = `/#project-${index}`;

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
    <meta http-equiv="refresh" content="0; url=${escapeHtml(redirectHash)}" />
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
  </body>
</html>`);
});

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


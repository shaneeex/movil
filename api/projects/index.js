
import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { parseMultipartForm, parseJsonBody } from "../../lib/multipart.js";
import { uploadMediaStream } from "../../lib/media.js";
import {
  getProjects,
  saveProjects,
  applySpotlight,
  sanitizeIncomingMediaEntry,
} from "../../lib/projects.js";
import { normalizeCategory, normalizeClient, parseBoolean } from "../../lib/utils.js";

export default withErrorHandling(async function handler(req, res) {
  if (req.method === "GET") {
    const projects = await getProjects();
    return sendJSON(res, 200, projects);
  }

  if (req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  if (!requireAdmin(req, res)) return;

  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    const body = await parseJsonBody(req);
    const projects = await getProjects();
    const shouldSpotlight = parseBoolean(body?.spotlight, false);
    const media = Array.isArray(body?.media)
      ? body.media.map(sanitizeIncomingMediaEntry).filter(Boolean)
      : [];

    if (!media.length) {
      return sendJSON(res, 400, { ok: false, error: "At least one media item is required." });
    }

    const newProject = {
      title: (body?.title || "").trim(),
      description: (body?.description || "").trim(),
      category: normalizeCategory(body?.category),
      client: normalizeClient(body?.client),
      media,
      spotlight: shouldSpotlight,
      createdAt: new Date().toISOString(),
    };
    projects.push(newProject);
    if (shouldSpotlight) {
      applySpotlight(projects, projects.length - 1, true);
    }
    await saveProjects(projects);
    return sendJSON(res, 200, { ok: true, project: newProject, size: projects.length });
  }

  const { fields, files } = await parseMultipartForm(req, {
    onFile: ({ file, filename, mimeType }) => uploadMediaStream({ file, filename, mimeType }),
  });

  const projects = await getProjects();
  const shouldSpotlight = parseBoolean(fields.spotlight, false);
  const media = Array.isArray(files) ? files : [];

  const newProject = {
    title: (fields.title || "").trim(),
    description: (fields.description || "").trim(),
    category: normalizeCategory(fields.category),
    client: normalizeClient(fields.client),
    media,
    spotlight: shouldSpotlight,
    createdAt: new Date().toISOString(),
  };
  projects.push(newProject);
  if (shouldSpotlight) {
    applySpotlight(projects, projects.length - 1, true);
  }
  await saveProjects(projects);

  sendJSON(res, 200, { ok: true, project: newProject, size: projects.length });
});

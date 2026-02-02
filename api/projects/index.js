
import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { parseMultipartForm, parseJsonBody } from "../../lib/multipart.js";
import { uploadMediaStream } from "../../lib/media.js";
import {
  getProjects,
  saveProjects,
  sanitizeIncomingMediaEntry,
  sanitizeHeroMediaUrl,
  parseProjectOrder,
} from "../../lib/projects.js";
import {
  normalizeCategory,
  normalizeClient,
  parseBoolean,
  normalizeStatus,
  normalizeTags,
} from "../../lib/utils.js";

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
    const shouldFeature = parseBoolean(body?.featured, false);
    const draftOverride =
      body?.draft !== undefined ? (parseBoolean(body.draft, false) ? "draft" : "published") : undefined;
    const status = normalizeStatus(body?.status ?? draftOverride);
    const tags = normalizeTags(body?.tags);
    const media = Array.isArray(body?.media)
      ? body.media.map(sanitizeIncomingMediaEntry).filter(Boolean)
      : [];

    if (!media.length) {
      return sendJSON(res, 400, { ok: false, error: "At least one media item is required." });
    }

    const featuredEnabled = status === "published" && shouldFeature;
    const order = parseProjectOrder(body?.order ?? body?.displayOrder ?? body?.sort);

    const newProject = {
      title: (body?.title || "").trim(),
      description: (body?.description || "").trim(),
      category: normalizeCategory(body?.category),
      client: normalizeClient(body?.client),
      media,
      heroMediaUrl: sanitizeHeroMediaUrl({ media }, body?.heroMediaUrl),
      featured: featuredEnabled,
      status,
      tags,
      createdAt: new Date().toISOString(),
      order,
    };
    projects.push(newProject);
    await saveProjects(projects);
    return sendJSON(res, 200, { ok: true, project: newProject, size: projects.length });
  }

  const { fields, files } = await parseMultipartForm(req, {
    onFile: ({ file, filename, mimeType }) => uploadMediaStream({ file, filename, mimeType }),
  });

  const projects = await getProjects();
  const shouldFeature = parseBoolean(fields.featured, false);
  const draftOverride =
    fields.draft !== undefined ? (parseBoolean(fields.draft, false) ? "draft" : "published") : undefined;
  const status = normalizeStatus(fields.status ?? draftOverride);
  const tags = normalizeTags(fields.tags);
  const media = Array.isArray(files) ? files : [];

  const featuredEnabled = status === "published" && shouldFeature;
  const order = parseProjectOrder(fields.order ?? fields.displayOrder ?? fields.sort);

  const newProject = {
    title: (fields.title || "").trim(),
    description: (fields.description || "").trim(),
    category: normalizeCategory(fields.category),
    client: normalizeClient(fields.client),
    media,
    heroMediaUrl: sanitizeHeroMediaUrl({ media }, fields.heroMediaUrl),
    featured: featuredEnabled,
    status,
    tags,
    createdAt: new Date().toISOString(),
    order,
  };
  projects.push(newProject);
  await saveProjects(projects);

  sendJSON(res, 200, { ok: true, project: newProject, size: projects.length });
});

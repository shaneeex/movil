
import { withErrorHandling, sendJSON, methodNotAllowed, notFound } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { parseMultipartForm, parseJsonBody } from "../../lib/multipart.js";
import { uploadMediaStream, deleteMedia } from "../../lib/media.js";
import {
  getProjects,
  saveProjects,
  sanitizeIncomingMediaEntry,
  sanitizeRemovalEntry,
  sanitizeMediaFocusUpdate,
  sanitizeHeroMediaUrl,
  parseProjectOrder,
} from "../../lib/projects.js";
import {
  normalizeCategory,
  normalizeClient,
  normalizeStatus,
  normalizeTags,
  parseBoolean,
  safeJSONParse,
} from "../../lib/utils.js";

export default withErrorHandling(async function handler(req, res) {
  const index = Number.parseInt(req.query?.index, 10);
  if (!Number.isInteger(index) || index < 0) {
    return notFound(res);
  }

  const projects = await getProjects();
  if (index >= projects.length) {
    return notFound(res);
  }

  if (req.method === "DELETE") {
    if (!requireAdmin(req, res)) return;

    const [removed] = projects.splice(index, 1);
    await saveProjects(projects);
    if (removed?.media?.length) {
      await Promise.all(removed.media.map((m) => deleteMedia(m)));
    }
    return sendJSON(res, 200, { ok: true, removed });
  }

  if (req.method !== "PUT") {
    return methodNotAllowed(res, ["PUT", "DELETE"]);
  }

  if (!requireAdmin(req, res)) return;

  const contentType = req.headers["content-type"] || "";
  const project = projects[index];

  if (contentType.includes("application/json")) {
    const body = await parseJsonBody(req);

    if (typeof body.title === "string") project.title = body.title.trim();
    if (typeof body.description === "string") project.description = body.description.trim();
    if (typeof body.category === "string") project.category = normalizeCategory(body.category);
    if (typeof body.client === "string") project.client = normalizeClient(body.client);

    if (body.status !== undefined) {
      project.status = normalizeStatus(body.status);
      if (project.status === "draft") {
        project.featured = false;
      }
    } else if (body.draft !== undefined) {
      const isDraft = parseBoolean(body.draft, false);
      project.status = normalizeStatus(isDraft ? "draft" : "published");
      if (project.status === "draft") {
        project.featured = false;
      }
    }

    if (body.tags !== undefined) {
      project.tags = normalizeTags(body.tags);
    }

    if (typeof body.heroMediaUrl === "string") {
      project.heroMediaUrl = body.heroMediaUrl.trim();
    }

    let removalEntries = [];
    if (Array.isArray(body?.removed)) {
      removalEntries = body.removed.map(sanitizeRemovalEntry).filter(Boolean);
    }
    if (removalEntries.length) {
      const removeSet = new Set(removalEntries.map((item) => item.url));
      project.media = (project.media || []).filter((media) => !removeSet.has(media.url));
      await Promise.all(removalEntries.map((media) => deleteMedia(media)));
    }

    if (Array.isArray(body?.newMedia) && body.newMedia.length) {
      const sanitized = body.newMedia.map(sanitizeIncomingMediaEntry).filter(Boolean);
      if (sanitized.length) {
        project.media = [...(project.media || []), ...sanitized];
      }
    }

    if (Array.isArray(body?.mediaFocus) && body.mediaFocus.length) {
      applyMediaFocusUpdates(project, body.mediaFocus);
    }

    project.heroMediaUrl = sanitizeHeroMediaUrl(project, project.heroMediaUrl);
    if (
      body.order !== undefined ||
      body.displayOrder !== undefined ||
      body.sort !== undefined
    ) {
      project.order = parseProjectOrder(body.order ?? body.displayOrder ?? body.sort);
    }

    await saveProjects(projects);
    return sendJSON(res, 200, { ok: true, project, index });
  }

  const { fields, files } = await parseMultipartForm(req, {
    onFile: ({ file, filename, mimeType }) => uploadMediaStream({ file, filename, mimeType }),
  });

  if (typeof fields.title === "string") project.title = fields.title.trim();
  if (typeof fields.description === "string") project.description = fields.description.trim();
  if (typeof fields.category === "string") project.category = normalizeCategory(fields.category);
  if (typeof fields.client === "string") project.client = normalizeClient(fields.client);

  if (fields.status !== undefined) {
    project.status = normalizeStatus(fields.status);
    if (project.status === "draft") {
      project.featured = false;
    }
  } else if (fields.draft !== undefined) {
    const isDraft = parseBoolean(fields.draft, false);
    project.status = normalizeStatus(isDraft ? "draft" : "published");
    if (project.status === "draft") {
      project.featured = false;
    }
  }

  if (fields.tags !== undefined) {
    project.tags = normalizeTags(fields.tags);
  }

  if (typeof fields.heroMediaUrl === "string") {
    project.heroMediaUrl = fields.heroMediaUrl.trim();
  }

  let removedItems = [];
  if (typeof fields.removed === "string" && fields.removed.trim()) {
    removedItems = safeJSONParse(fields.removed, []);
    if (!Array.isArray(removedItems)) removedItems = [];
  }
  if (removedItems.length) {
    const removeSet = new Set(removedItems.map((item) => item?.url).filter(Boolean));
    project.media = (project.media || []).filter((media) => !removeSet.has(media.url));
    await Promise.all(removedItems.map((media) => deleteMedia(media)));
  }

  if (Array.isArray(files) && files.length) {
    project.media = [...(project.media || []), ...files];
  }

  if (fields.mediaFocus !== undefined) {
    let focusEntries = [];
    if (typeof fields.mediaFocus === "string" && fields.mediaFocus.trim()) {
      focusEntries = safeJSONParse(fields.mediaFocus, []);
      if (!Array.isArray(focusEntries)) focusEntries = [];
    }
    if (Array.isArray(focusEntries) && focusEntries.length) {
      applyMediaFocusUpdates(project, focusEntries);
    }
  }

  project.heroMediaUrl = sanitizeHeroMediaUrl(project, project.heroMediaUrl);
  if (
    fields.order !== undefined ||
    fields.displayOrder !== undefined ||
    fields.sort !== undefined
  ) {
    project.order = parseProjectOrder(fields.order ?? fields.displayOrder ?? fields.sort);
  }

  await saveProjects(projects);
  return sendJSON(res, 200, { ok: true, project, index });
});

function applyMediaFocusUpdates(project, entries) {
  if (!project || !Array.isArray(project.media)) return;
  const sanitized = entries.map(sanitizeMediaFocusUpdate).filter(Boolean);
  if (!sanitized.length) return;
  const map = new Map();
  sanitized.forEach(({ url, focus }) => {
    map.set(url, focus);
  });
  project.media = project.media.map((media) => {
    if (!media || typeof media.url !== "string") return media;
    const mediaUrl = media.url.trim();
    const focus = map.get(mediaUrl);
    if (!focus) return media;
    return { ...media, focus };
  });
}
    if (body.featured !== undefined) {
      const enableFeatured = parseBoolean(body.featured, false);
      project.featured = project.status === "published" && enableFeatured;
    }
  if (fields.featured !== undefined) {
    const enableFeatured = parseBoolean(fields.featured, false);
    project.featured = project.status === "published" && enableFeatured;
  }

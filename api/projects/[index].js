
import { withErrorHandling, sendJSON, methodNotAllowed, notFound } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { parseMultipartForm } from "../../lib/multipart.js";
import { uploadMediaStream, deleteMedia } from "../../lib/media.js";
import { getProjects, saveProjects, applySpotlight } from "../../lib/projects.js";
import { normalizeCategory, normalizeClient, parseBoolean, safeJSONParse } from "../../lib/utils.js";

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

  const { fields, files } = await parseMultipartForm(req, {
    onFile: ({ file, filename, mimeType }) => uploadMediaStream({ file, filename, mimeType }),
  });

  const project = projects[index];

  if (typeof fields.title === "string") project.title = fields.title.trim();
  if (typeof fields.description === "string") project.description = fields.description.trim();
  if (typeof fields.category === "string") project.category = normalizeCategory(fields.category);
  if (typeof fields.client === "string") project.client = normalizeClient(fields.client);

  if (fields.spotlight !== undefined) {
    const enableSpotlight = parseBoolean(fields.spotlight, false);
    applySpotlight(projects, index, enableSpotlight);
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

  await saveProjects(projects);
  return sendJSON(res, 200, { ok: true, project, index });
});

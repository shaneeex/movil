export function normalizeCategory(value) {
  if (typeof value !== "string") return "General";
  const trimmed = value.trim();
  if (!trimmed) return "General";
  return trimmed.replace(/\s+/g, " ").slice(0, 64);
}

export function normalizeClient(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 120);
}

export function normalizeStatus(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "draft") return "draft";
  }
  if (typeof value === "boolean") {
    return value ? "draft" : "published";
  }
  return "published";
}

export function normalizeTags(value, { limit = 8, maxLength = 32 } = {}) {
  let tags = [];
  if (Array.isArray(value)) {
    tags = value;
  } else if (typeof value === "string") {
    tags = value.split(/[,;]+/);
  } else {
    return [];
  }

  const seen = new Set();
  const result = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/\s+/g, " ").slice(0, maxLength);
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

export function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function slugify(value = "") {
  if (typeof value !== "string") return "movil-project";
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "movil-project";
}

export function buildShareKey(project, index) {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  if (!project || typeof project !== "object") {
    return `i${safeIndex}`;
  }

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
      entry.cloudinaryId.trim()
  );
  if (mediaWithId) {
    const cleaned = mediaWithId.cloudinaryId.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    if (cleaned) {
      return `m${cleaned.slice(-12)}`;
    }
  }

  const mediaWithUrl = mediaItems.find(
    (entry) => entry && typeof entry.url === "string" && entry.url.trim()
  );
  if (mediaWithUrl) {
    const cleaned = mediaWithUrl.url.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    if (cleaned) {
      return `u${cleaned.slice(-12)}`;
    }
  }

  const slug = slugify(project.title || "");
  if (slug && slug !== "movil-project") {
    return `s${slug.slice(0, 12)}`;
  }

  return `i${safeIndex}`;
}

export function buildShareId(project, index) {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  const shareKey = buildShareKey(project, safeIndex);
  return `${shareKey}-${slugify(project?.title || "")}`;
}

export function sanitizeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed}`;
}

export function safeJSONParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

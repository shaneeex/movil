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

export function buildShareId(project, index) {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  return `${safeIndex}-${slugify(project?.title || "")}`;
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

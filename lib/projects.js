import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_FILE_PATH,
  PROJECTS_STORAGE,
  CLOUDINARY_UPLOAD_FOLDER,
  SITE_ORIGIN,
} from "./env.js";
import { CLOUDINARY_ENABLED, cloudinary } from "./cloudinary.js";
import {
  buildShareId,
  normalizeCategory,
  normalizeClient,
  normalizeStatus,
  normalizeTags,
} from "./utils.js";

const baseFolder = (process.env.CLOUDINARY_PROJECTS_FOLDER ||
  `${CLOUDINARY_UPLOAD_FOLDER.replace(/\/+$/, "")}-data`).replace(/^\/+|\/+$/g, "");
const PROJECTS_PUBLIC_ID = (
  process.env.CLOUDINARY_PROJECTS_ID || `${baseFolder}/projects.json`
).replace(/^\/+/, "");

let cache = null;
let cacheTime = 0;
const CACHE_TTL_MS = 10_000;

function clampFocusValue(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function parseFocusComponent(value) {
  if (typeof value === "number") return clampFocusValue(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return clampFocusValue(parsed);
    }
  }
  return null;
}

function extractFocus(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const source = typeof entry.focus === "object" && entry.focus ? entry.focus : null;
  const xCandidate =
    parseFocusComponent(source?.x) ??
    parseFocusComponent(entry.focusX) ??
    parseFocusComponent(entry.focus_x);
  const yCandidate =
    parseFocusComponent(source?.y) ??
    parseFocusComponent(entry.focusY) ??
    parseFocusComponent(entry.focus_y);
  const zoomCandidate =
    parseZoomComponent(source?.zoom ?? source?.scale) ??
    parseZoomComponent(entry.focusZoom) ??
    parseZoomComponent(entry.zoom);

  if (xCandidate === null && yCandidate === null && zoomCandidate === null) return undefined;
  const x = xCandidate === null ? 50 : xCandidate;
  const y = yCandidate === null ? 50 : yCandidate;
  const zoom = zoomCandidate === null ? 1 : zoomCandidate;
  return { x, y, zoom };
}

function clampFocusZoom(value) {
  if (!Number.isFinite(value)) return null;
  const min = 1;
  const max = 2;
  if (value < min) return min;
  if (value > max) return max;
  return Math.round(value * 1000) / 1000;
}

function parseZoomComponent(value) {
  if (typeof value === "number") return clampFocusZoom(value);
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim();
    const percentLike = normalized.endsWith("%");
    const stripped = percentLike ? normalized.slice(0, -1) : normalized;
    const parsed = Number.parseFloat(stripped);
    if (Number.isFinite(parsed)) {
      const candidate =
        percentLike || parsed > 10 ? parsed / 100 : parsed;
      return clampFocusZoom(candidate);
    }
  }
  return null;
}

function pickHeroMediaUrl(mediaList = [], preferred = "") {
  if (!Array.isArray(mediaList) || !mediaList.length) return "";
  if (preferred) {
    const match = mediaList.find((entry) => entry && entry.url === preferred);
    if (match && match.url) return match.url;
  }
  const firstImage = mediaList.find(
    (entry) => entry && (entry.type || "").toLowerCase() !== "video",
  );
  if (firstImage?.url) return firstImage.url;
  const first = mediaList.find((entry) => entry && entry.url);
  return first?.url || "";
}

export function sanitizeHeroMediaUrl(project, preferredUrl) {
  const mediaList = Array.isArray(project?.media) ? project.media : [];
  const fallback = typeof project?.heroMediaUrl === "string" ? project.heroMediaUrl : "";
  return pickHeroMediaUrl(mediaList, (preferredUrl || "").trim() || fallback);
}

function normalizeProjects(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw.map((project) => {
    const media = normalizeMediaList(project?.media);
    const preferredHero =
      typeof project?.heroMediaUrl === "string" ? project.heroMediaUrl.trim() : "";
    const order = parseProjectOrder(project?.order ?? project?.sort ?? project?.displayOrder);
    return {
      title: (project?.title || "").trim(),
      description: (project?.description || "").trim(),
      category: normalizeCategory(project?.category),
      client: normalizeClient(project?.client),
      media,
      heroMediaUrl: pickHeroMediaUrl(media, preferredHero),
      spotlight: normalizeStatus(project?.status) === "published" && Boolean(project?.spotlight),
      status: normalizeStatus(project?.status),
      tags: normalizeTags(project?.tags || []),
      createdAt: project?.createdAt || new Date().toISOString(),
      order,
    };
  });
}

function normalizeMediaList(media = []) {
  if (!Array.isArray(media)) return [];
  return media.map(sanitizeIncomingMediaEntry).filter(Boolean);
}

async function fetchFromCloudinary() {
  if (!CLOUDINARY_ENABLED) return [];
  try {
    const resource = await cloudinary.api.resource(PROJECTS_PUBLIC_ID, {
      resource_type: "raw",
    });
    if (!resource?.secure_url) return [];
    const response = await fetch(resource.secure_url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Cloudinary raw fetch failed with ${response.status}`);
    }
    const text = await response.text();
    if (!text.trim()) return [];
    return JSON.parse(text);
  } catch (err) {
    const code = err?.http_code || err?.status;
    if (code === 404 || /not found/i.test(err?.message || "")) {
      return [];
    }
    throw err;
  }
}

async function saveToCloudinary(projects) {
  const payload = JSON.stringify(projects, null, 2);
  await new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: PROJECTS_PUBLIC_ID,
        overwrite: true,
      },
      (error) => {
        if (error) return reject(error);
        resolve();
      }
    );
    upload.end(Buffer.from(payload, "utf8"));
  });
}

async function fetchFromFile() {
  try {
    const json = await fs.readFile(path.resolve(DATA_FILE_PATH), "utf8");
    return JSON.parse(json);
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function saveToFile(projects) {
  const payload = JSON.stringify(projects, null, 2);
  await fs.writeFile(path.resolve(DATA_FILE_PATH), payload, "utf8");
}

export async function getProjects({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const raw =
    PROJECTS_STORAGE === "cloudinary" ? await fetchFromCloudinary() : await fetchFromFile();
  const normalized = normalizeProjects(raw);
  if (!normalized.length && PROJECTS_STORAGE === "cloudinary") {
    const fallback = await fetchFromFile();
    const fileNormalized = normalizeProjects(fallback);
    cache = fileNormalized;
    cacheTime = now;
    return fileNormalized;
  }
  cache = normalized;
  cacheTime = now;
  return normalized;
}

export async function saveProjects(projects) {
  const normalized = normalizeProjects(projects);
  if (PROJECTS_STORAGE === "cloudinary") {
    await saveToCloudinary(normalized);
  } else {
    await saveToFile(normalized);
  }
  cache = normalized;
  cacheTime = Date.now();
  return normalized;
}

export function applySpotlight(projects, index, enable) {
  if (!Array.isArray(projects)) return null;
  const targetIndex = Number.parseInt(index, 10);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= projects.length) {
    return null;
  }
  if (enable) {
    projects[targetIndex].spotlight = true;
    projects[targetIndex].status = "published";
  } else {
    projects[targetIndex].spotlight = false;
  }
  return projects[targetIndex];
}

export function sanitizeIncomingMediaEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url) return null;
  const type = entry.type === "video" ? "video" : "image";
  const thumbnailRaw =
    typeof entry.thumbnail === "string" && entry.thumbnail.trim() ? entry.thumbnail.trim() : url;
  const cloudinaryId =
    typeof entry.cloudinaryId === "string" && entry.cloudinaryId.trim()
      ? entry.cloudinaryId.trim()
      : undefined;
  const resourceType =
    entry.cloudinaryResourceType === "video" || type === "video" ? "video" : "image";
  const originalFilename =
    typeof entry.originalFilename === "string" && entry.originalFilename.trim()
      ? entry.originalFilename.trim()
      : undefined;
  const focus = extractFocus(entry);

  return {
    url,
    type,
    thumbnail: thumbnailRaw,
    cloudinaryId,
    cloudinaryResourceType: resourceType,
    originalFilename,
    ...(focus ? { focus } : {}),
  };
}

export function sanitizeRemovalEntry(entry) {
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url) return null;
  const result = { url };
  if (typeof entry.thumbnail === "string" && entry.thumbnail.trim()) {
    result.thumbnail = entry.thumbnail.trim();
  }
  if (typeof entry.cloudinaryId === "string" && entry.cloudinaryId.trim()) {
    result.cloudinaryId = entry.cloudinaryId.trim();
  }
  if (entry.cloudinaryResourceType === "video") {
    result.cloudinaryResourceType = "video";
  } else if (entry.cloudinaryResourceType === "image") {
    result.cloudinaryResourceType = "image";
  }
  return result;
}

export function sanitizeMediaFocusUpdate(entry) {
  if (!entry || typeof entry !== "object") return null;
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url) return null;
  const focus = extractFocus(entry);
  if (!focus) return null;
  return { url, focus };
}

export function parseProjectOrder(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function getSharePageMeta(project, index) {
  const shareId = buildShareId(project, index);
  const canonicalPath = `/p/${shareId}`;
  const canonicalUrl = new URL(canonicalPath, SITE_ORIGIN).toString();
  const title = (project.title || "Movil Project").trim() || "Movil Project";
  const description =
    (project.description || "Explore more signage projects crafted by Movil.").replace(/\s+/g, " ").trim() ||
    "Explore more signage projects crafted by Movil.";
  const imageUrl = resolveShareImageUrl(project);
  return {
    shareId,
    canonicalUrl,
    title,
    description,
    imageUrl,
  };
}

function resolveShareImageUrl(project) {
  const fallback = `${SITE_ORIGIN}/static/default-video-thumb.jpg`;
  const primaryMedia = selectPrimaryMedia(project);
  const rawUrl = primaryMedia?.thumbnail || primaryMedia?.url;
  if (!rawUrl) return fallback;
  return applyShareImageTransform(rawUrl) || fallback;
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

  const firstImage = mediaList.find(
    (entry) => (entry.type || "").toLowerCase() !== "video"
  );
  if (firstImage) return firstImage;

  const firstWithThumb = mediaList.find((entry) => entry.thumbnail);
  if (firstWithThumb) return firstWithThumb;

  return mediaList[0];
}

function applyShareImageTransform(url) {
  try {
    const absolute = new URL(url, SITE_ORIGIN);
    if (
      absolute.hostname.includes("res.cloudinary.com") &&
      absolute.pathname.includes("/upload/")
    ) {
      const [prefix, suffix] = absolute.pathname.split("/upload/");
      if (suffix) {
        const transformation = "f_auto,q_auto,a_auto_right,c_fill,g_auto,w_1200,h_630";
        if (!suffix.startsWith(transformation)) {
          const normalizedPrefix =
            prefix && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix || "";
          const normalizedSuffix = suffix.startsWith("/")
            ? suffix.slice(1)
            : suffix;
          let nextPath = `${normalizedPrefix}/upload/${transformation}/${normalizedSuffix}`;
          if (!nextPath.startsWith("/")) {
            nextPath = `/${nextPath}`;
          }
          absolute.pathname = nextPath;
        }
      }
    }
    return absolute.toString();
  } catch (err) {
    return url;
  }
}

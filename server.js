import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import multer from "multer";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import path from "path";
import os from "os";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

if (ffmpegInstaller?.path) {
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
} else {
  console.warn("FFmpeg installer path not resolved; falling back to system ffmpeg if available.");
}
if (ffprobeInstaller?.path) {
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
} else {
  console.warn("FFprobe installer path not resolved; screenshots may fail.");
}

const app = express();
app.set("trust proxy", true);
const PORT = 3000;
const fsp = fs.promises;

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "298984822447826";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || "";
const CLOUDINARY_UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || "movil/projects";
const CLOUDINARY_HAS_CLOUD = Boolean(CLOUDINARY_CLOUD_NAME);
const CLOUDINARY_SIGNED_UPLOAD = CLOUDINARY_HAS_CLOUD && Boolean(CLOUDINARY_API_SECRET);
const CLOUDINARY_UNSIGNED_UPLOAD = CLOUDINARY_HAS_CLOUD && Boolean(CLOUDINARY_UPLOAD_PRESET);
const CLOUDINARY_ENABLED = CLOUDINARY_SIGNED_UPLOAD || CLOUDINARY_UNSIGNED_UPLOAD;

if (CLOUDINARY_HAS_CLOUD) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET || undefined,
    secure: true,
  });
}

const UPLOAD_DIR = path.resolve("public/uploads");
const TEMP_UPLOAD_DIR = path.join(process.env.TMPDIR || os.tmpdir(), "movil-uploads");
const DATA_FILE  = path.resolve("projects.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "movilstudio!";
const ADMIN_COOKIE = "admin_token";
const DEFAULT_VIDEO_THUMB = path.join(UPLOAD_DIR, "default-video-thumb.jpg");
const DEFAULT_VIDEO_THUMB_URL = "/uploads/default-video-thumb.jpg";
const VIDEO_SCREENSHOT_TIMEOUT_MS = 15000;
const VIDEO_SCREENSHOT_SIZE = "640x?"; // keeps aspect ratio while shrinking width
const VIDEO_SCREENSHOT_TIMEMARK = 0.5;

let defaultVideoThumbPromise = null;

if (!CLOUDINARY_ENABLED) {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
} else {
  if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
    fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  }
}

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  if (process.env.VERCEL === "1") {
    console.log(
      JSON.stringify({
        vercel: true,
        method: req.method,
        originalUrl: req.originalUrl,
        url: req.url,
        headers: {
          "x-vercel-forwarded-path": req.headers["x-vercel-forwarded-path"],
          "x-forwarded-path": req.headers["x-forwarded-path"],
          "x-original-uri": req.headers["x-original-uri"],
        },
      })
    );
  }
  next();
});
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie;
  if (raw) {
    raw.split(";").forEach((pair) => {
      const [key, ...rest] = pair.trim().split("=");
      req.cookies[key] = decodeURIComponent(rest.join("="));
    });
  }
  next();
});

// ---------- Multer ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = CLOUDINARY_ENABLED ? TEMP_UPLOAD_DIR : UPLOAD_DIR;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + (file.originalname || file.fieldname)),
});
const upload = multer({ storage });

// ---------- Helpers ----------
function readProjects() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!Array.isArray(raw)) return [];
  return raw.map((proj) => ({
    ...proj,
    category: normalizeCategoryInput(proj?.category),
    client: normalizeClientInput(proj?.client),
    media: Array.isArray(proj?.media) ? proj.media : [],
    spotlight: Boolean(proj?.spotlight),
  }));
}
function saveProjects(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function toFsPathFromUrl(urlPath) {
  // urlPath like "/uploads/abc.jpg" → absolute fs path
  const rel = urlPath.replace(/^\/+uploads\/+/, ""); // strip leading /uploads/
  const abs = path.resolve(UPLOAD_DIR, rel);
  // safety guard: ensure inside uploads dir
  if (!abs.startsWith(UPLOAD_DIR)) throw new Error("Unsafe path");
  return abs;
}
function safeUnlink(urlPath) {
  try {
    if (!urlPath || urlPath === DEFAULT_VIDEO_THUMB_URL) return;
    const p = toFsPathFromUrl(urlPath);
    if (p === DEFAULT_VIDEO_THUMB) return;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) { /* ignore */ }
}

function buildCloudinaryPublicId(fileName = "", resourceType = "image") {
  const baseName = slugifyTitle(path.parse(fileName || "").name || resourceType);
  const suffix = Date.now().toString(36);
  const folder = (CLOUDINARY_UPLOAD_FOLDER || "").replace(/^\/+|\/+$/g, "");
  const id = `${baseName}-${suffix}`;
  return folder ? `${folder}/${id}` : id;
}

async function cleanupLocalFile(filePath) {
  if (!filePath) return;
  if (!path.isAbsolute(filePath)) return;
  const normalized = path.resolve(filePath);
  const allowedRoots = [UPLOAD_DIR, TEMP_UPLOAD_DIR];
  if (!allowedRoots.some((dir) => normalized.startsWith(dir))) return;
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn("Unable to remove local upload:", err?.message || err);
    }
  }
}

async function uploadToCloudinary({ buffer, filePath, fileName, resourceType = "image", mimeType }) {
  if (!CLOUDINARY_ENABLED) return null;

  const uploadOptions = {
    resource_type: resourceType,
    folder: CLOUDINARY_UPLOAD_FOLDER || undefined,
    overwrite: false,
    unique_filename: true,
  };

  if (CLOUDINARY_SIGNED_UPLOAD) {
    uploadOptions.public_id = buildCloudinaryPublicId(fileName || resourceType, resourceType);
    if (buffer) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
          if (error) return reject(error);
          resolve(result);
        });
        stream.end(buffer);
      });
    }
    const targetPath = filePath || buffer;
    if (!targetPath) throw new Error("No file data available for Cloudinary upload.");
    return cloudinary.uploader.upload(targetPath, uploadOptions);
  }

  const unsignedPreset = CLOUDINARY_UPLOAD_PRESET;
  if (!unsignedPreset) {
    throw new Error("Cloudinary unsigned upload preset is not configured.");
  }

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const form = new FormData();

  if (buffer) {
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    form.append("file", blob, fileName || `${resourceType}-upload`);
  } else if (filePath) {
    const fileBuffer = await fsp.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType || "application/octet-stream" });
    form.append("file", blob, fileName || path.basename(filePath));
  } else {
    throw new Error("No file data available for Cloudinary upload.");
  }

  form.append("upload_preset", unsignedPreset);
  if (CLOUDINARY_UPLOAD_FOLDER) form.append("folder", CLOUDINARY_UPLOAD_FOLDER);

  const response = await fetch(uploadUrl, { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Cloudinary upload failed");
  }
  return data;
}

function buildCloudinaryImageThumbnail(publicId, fallbackUrl) {
  if (!publicId || !CLOUDINARY_HAS_CLOUD) return fallbackUrl || "";
  return cloudinary.url(publicId, {
    resource_type: "image",
    format: "jpg",
    transformation: [
      { width: 420, height: 280, crop: "fill", gravity: "auto" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
}

function buildCloudinaryVideoThumbnail(publicId, fallbackUrl) {
  if (!publicId || !CLOUDINARY_HAS_CLOUD) return fallbackUrl || DEFAULT_VIDEO_THUMB_URL;
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "jpg",
    transformation: [
      { width: 640, height: 360, crop: "fill", gravity: "auto" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
}

async function deleteCloudinaryAsset(media) {
  if (!CLOUDINARY_SIGNED_UPLOAD) return;
  if (!media || !media.cloudinaryId) return;
  const resourceType =
    media.cloudinaryResourceType ||
    (media.type === "video" ? "video" : "image");
  try {
    await cloudinary.uploader.destroy(media.cloudinaryId, {
      resource_type: resourceType,
      invalidate: true,
    });
  } catch (err) {
    console.warn("Unable to delete Cloudinary asset:", err?.message || err);
  }
}

function normalizeCategoryInput(value) {
  if (typeof value !== 'string') return "General";
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/\s+/g, ' ') : "General";
}

function normalizeClientInput(value) {
  if (Array.isArray(value)) {
    value = value[0];
  }
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function slugifyTitle(value = "") {
  if (typeof value !== "string" || !value.trim()) return "movil-project";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "movil-project";
}

function buildProjectShareId(project, index) {
  const idx = Number.isInteger(index) ? index : Number.parseInt(index, 10);
  const safeIndex = Number.isInteger(idx) && idx >= 0 ? idx : 0;
  const slug = slugifyTitle(project?.title || "");
  return `${safeIndex}-${slug}`;
}

function findProjectByShareId(projects, shareId) {
  if (!Array.isArray(projects) || !projects.length) {
    return { project: null, index: -1 };
  }
  const [indexPart] = String(shareId || "").split("-");
  const index = Number.parseInt(indexPart, 10);
  if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
    return { project: null, index: -1 };
  }
  return { project: projects[index], index };
}

function applySpotlightStatus(projects, index, enable) {
  if (!Array.isArray(projects)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= projects.length) return null;

  if (enable) {
    projects.forEach((proj, idx) => {
      proj.spotlight = idx === index;
    });
  } else {
    projects[index].spotlight = false;
  }
  return projects[index];
}

async function ensureDefaultVideoThumb() {
  if (fs.existsSync(DEFAULT_VIDEO_THUMB)) return DEFAULT_VIDEO_THUMB;
  if (!defaultVideoThumbPromise) {
    defaultVideoThumbPromise = new Promise((resolve) => {
      const cmd = ffmpeg()
        .input(`testsrc=duration=1:size=640x360:rate=30`)
        .inputFormat("lavfi")
        .outputOptions(["-frames:v 1", "-q:v 7"])
        .size(VIDEO_SCREENSHOT_SIZE)
        .output(DEFAULT_VIDEO_THUMB)
        .on("end", () => resolve(DEFAULT_VIDEO_THUMB))
        .on("error", (err) => {
          console.error("Failed to create default video thumbnail:", err?.message || err);
          resolve(null);
        });
      cmd.run();
    });
  }
  await defaultVideoThumbPromise;
  return DEFAULT_VIDEO_THUMB;
}

async function probeVideoDurationSeconds(videoPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return resolve(null);
      const duration = data?.format?.duration;
      if (typeof duration === "number" && duration > 0) return resolve(duration);
      return resolve(null);
    });
  });
}

async function createVideoThumbnail(videoPath, filename) {
  await ensureDefaultVideoThumb();

  const baseName = path.parse(filename).name;
  const thumbName = `${baseName}-thumb.jpg`;
  const thumbPath = path.join(UPLOAD_DIR, thumbName);
  const fallback = {
    path: DEFAULT_VIDEO_THUMB,
    url: DEFAULT_VIDEO_THUMB_URL,
  };

  if (fs.existsSync(thumbPath)) {
    try {
      fs.unlinkSync(thumbPath);
    } catch (err) {
      console.warn("Unable to clear prior video thumbnail:", err?.message || err);
    }
  }

  const absoluteVideoPath = path.resolve(videoPath);
  const duration = await probeVideoDurationSeconds(absoluteVideoPath);
  const minSeek = 0.05;
  const maxSeek = typeof duration === "number" && duration > minSeek
    ? Math.max(duration - 0.15, minSeek)
    : null;
  let seekSeconds = VIDEO_SCREENSHOT_TIMEMARK;
  if (typeof duration === "number" && duration > 0) {
    const midpoint = duration / 2;
    seekSeconds = midpoint;
    if (seekSeconds < minSeek) seekSeconds = minSeek;
    if (maxSeek !== null && seekSeconds > maxSeek) seekSeconds = maxSeek;
  }
  if (!Number.isFinite(seekSeconds) || seekSeconds < minSeek) {
    seekSeconds = minSeek;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result || fallback);
    };

    try {
      const command = ffmpeg(absoluteVideoPath)
        .seekInput(seekSeconds)
        .outputOptions(["-frames:v 1", "-q:v 4"])
        .size(VIDEO_SCREENSHOT_SIZE)
        .output(thumbPath)
        .on("end", () => {
          if (!fs.existsSync(thumbPath)) {
            finish(fallback);
            return;
          }
          const stat = fs.statSync(thumbPath);
          if (!stat || stat.size === 0) {
            console.warn(`Generated thumbnail empty for ${thumbName}, using fallback`);
            finish(fallback);
            return;
          }
          finish({
            path: thumbPath,
            url: `/uploads/${path.basename(thumbPath)}`,
          });
        })
        .on("error", (err) => {
          console.error("Video thumbnail generation failed:", err?.message || err);
          finish(fallback);
        });

      command.run();

      setTimeout(() => {
        if (!resolved) {
          console.warn(`Video thumbnail timed out for ${path.basename(videoPath)}`);
          try {
            command.kill("SIGKILL");
          } catch (_) { /* ignore */ }
          finish(fallback);
        }
      }, VIDEO_SCREENSHOT_TIMEOUT_MS);
    } catch (err) {
      console.error("Video thumbnail pipeline crashed:", err?.message || err);
      finish(fallback);
    }
  });
}

function formatCookie(name, value, options = {}) {
  const base = `${name}=${value}`;
  const attrs = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    options.maxAge !== undefined ? `Max-Age=${options.maxAge}` : undefined,
    options.expires ? `Expires=${options.expires.toUTCString()}` : undefined,
  ].filter(Boolean);
  return `${base}; ${attrs.join("; ")}`;
}

function setAdminCookie(res, value, options = {}) {
  const opts = { ...options };
  if (opts.maxAge === 0 && !opts.expires) {
    opts.expires = new Date(0);
  }
  res.setHeader("Set-Cookie", formatCookie(ADMIN_COOKIE, value, opts));
}

function requireAdmin(req, res, next) {
  if (req.cookies[ADMIN_COOKIE] === "1") {
    return next();
  }
  if (req.accepts("html")) {
    return res.redirect("/admin-login.html");
  }
  return res.status(401).json({ ok: false, error: "Unauthorized" });
}

// images: compressed + thumb (local fallback)
async function processImageLocal(file) {
  const base = path.parse(file.filename).name;
  const full  = path.join(UPLOAD_DIR, `${base}-compressed.jpg`);
  const thumb = path.join(UPLOAD_DIR, `${base}-thumb.jpg`);

  await sharp(file.path).rotate().resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(full);
  await sharp(file.path).rotate().resize({ width: 300 }).jpeg({ quality: 70 }).toFile(thumb);
  await cleanupLocalFile(file.path);

  return {
    url: `/uploads/${path.basename(full)}`,
    thumbnail: `/uploads/${path.basename(thumb)}`,
    type: "image",
  };
}

// videos: thumbnail via ffmpeg (fallback to generated placeholder if needed)
async function processVideoLocal(file) {
  const savedPath = path.join(UPLOAD_DIR, file.filename);
  const thumbData = await createVideoThumbnail(savedPath, file.filename);
  return {
    url: `/uploads/${file.filename}`,
    thumbnail: thumbData.url,
    type: "video",
  };
}

async function processImageCloudinary(file) {
  const source = file.buffer || file.path;
  if (!source) throw new Error("Image source is unavailable.");

  const optimized = await sharp(source)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const uploadResult = await uploadToCloudinary({
    buffer: optimized,
    fileName: file.originalname || file.filename,
    resourceType: "image",
    mimeType: "image/jpeg",
  });

  await cleanupLocalFile(file.path);

  if (!uploadResult?.secure_url) {
    throw new Error("Cloudinary image upload did not return a URL.");
  }

  const publicId = uploadResult.public_id || null;
  const secureUrl = uploadResult.secure_url;
  const thumbUrl = buildCloudinaryImageThumbnail(publicId, secureUrl) || secureUrl;

  return {
    url: secureUrl,
    thumbnail: thumbUrl,
    type: "image",
    cloudinaryId: publicId,
    cloudinaryResourceType: "image",
  };
}

async function processVideoCloudinary(file) {
  const uploadResult = await uploadToCloudinary({
    filePath: file.path,
    fileName: file.originalname || file.filename,
    resourceType: "video",
    mimeType: file.mimetype,
  });

  await cleanupLocalFile(file.path);

  if (!uploadResult?.secure_url) {
    throw new Error("Cloudinary video upload did not return a URL.");
  }

  const publicId = uploadResult.public_id || null;
  const secureUrl = uploadResult.secure_url;
  const thumbUrl = buildCloudinaryVideoThumbnail(publicId, secureUrl) || secureUrl || DEFAULT_VIDEO_THUMB_URL;

  return {
    url: secureUrl,
    thumbnail: thumbUrl || DEFAULT_VIDEO_THUMB_URL,
    type: "video",
    cloudinaryId: publicId,
    cloudinaryResourceType: "video",
  };
}

async function processImage(file) {
  if (CLOUDINARY_ENABLED) {
    try {
      return await processImageCloudinary(file);
    } catch (err) {
      console.error("Cloudinary image upload failed:", err?.message || err);
    }
  }
  return processImageLocal(file);
}

async function processVideo(file) {
  if (CLOUDINARY_ENABLED) {
    try {
      return await processVideoCloudinary(file);
    } catch (err) {
      console.error("Cloudinary video upload failed:", err?.message || err);
    }
  }
  return processVideoLocal(file);
}

async function refreshMissingVideoThumbs() {
  if (CLOUDINARY_ENABLED) return;
  try {
    const projects = readProjects();
    let changed = false;

    for (const project of projects) {
      if (!Array.isArray(project.media)) continue;
      for (const media of project.media) {
        if (media?.cloudinaryId) continue;
        if (!media || media.type !== "video") continue;
        let needsRefresh = false;
        let thumbPath;

        if (!media.thumbnail || media.thumbnail === DEFAULT_VIDEO_THUMB_URL) {
          needsRefresh = true;
        } else {
          try {
            thumbPath = toFsPathFromUrl(media.thumbnail);
            if (!fs.existsSync(thumbPath)) needsRefresh = true;
          } catch {
            needsRefresh = true;
          }
        }

        if (!needsRefresh) continue;

        let videoPath;
        try {
          videoPath = toFsPathFromUrl(media.url);
        } catch {
          continue;
        }
        if (!fs.existsSync(videoPath)) continue;

        const thumbData = await createVideoThumbnail(videoPath, path.basename(videoPath));
        if (thumbData && thumbData.url !== media.thumbnail) {
          media.thumbnail = thumbData.url;
          changed = true;
        }
      }
    }

    if (changed) {
      saveProjects(projects);
      console.log("Updated missing video thumbnails.");
    }
  } catch (err) {
    console.error("Video thumbnail refresh failed:", err?.message || err);
  }
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getProjectShareImage(project) {
  const media = Array.isArray(project?.media) ? project.media : [];
  if (!media.length) return DEFAULT_VIDEO_THUMB_URL;

  const pickUrl = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const firstImage = media.find((m) => m && m.type === "image" && (pickUrl(m.url) || pickUrl(m.thumbnail)));
  if (firstImage) {
    return pickUrl(firstImage.url) || pickUrl(firstImage.thumbnail) || DEFAULT_VIDEO_THUMB_URL;
  }

  const firstWithThumb = media.find((m) => pickUrl(m?.thumbnail));
  if (firstWithThumb) {
    return pickUrl(firstWithThumb.thumbnail) || pickUrl(firstWithThumb.url) || DEFAULT_VIDEO_THUMB_URL;
  }

  const firstWithUrl = media.find((m) => pickUrl(m?.url));
  if (firstWithUrl) return pickUrl(firstWithUrl.url) || DEFAULT_VIDEO_THUMB_URL;

  const firstMedia = media[0];
  if (firstMedia) return pickUrl(firstMedia.thumbnail) || pickUrl(firstMedia.url) || DEFAULT_VIDEO_THUMB_URL;

  return DEFAULT_VIDEO_THUMB_URL;
}

function getRequestProtocol(req) {
  const forwarded = req.get("x-forwarded-proto");
  if (forwarded && typeof forwarded === "string") {
    const primary = forwarded.split(",")[0].trim();
    if (primary) return primary;
  }
  return req.protocol || "http";
}

function makeAbsoluteUrl(req, urlPath = "") {
  const protocol = getRequestProtocol(req);
  const host = req.get("host");
  const base = `${protocol}://${host}`;
  try {
    return new URL(urlPath || "/", base).toString();
  } catch {
    const safePath = typeof urlPath === "string" ? urlPath : "/";
    if (/^https?:\/\//i.test(safePath)) return safePath;
    const normalized = safePath.startsWith("/") ? safePath : `/${safePath}`;
    return `${base}${encodeURI(normalized)}`;
  }
}

// ---------- API Routes ----------

// GET all
app.get("/api/projects", (req, res) => {
  res.json(readProjects());
});

// POST create
app.post("/api/projects", requireAdmin, upload.array("media", 20), async (req, res) => {
  try {
    const projects = readProjects();
    const media = [];

    for (const f of req.files || []) {
      const ext = path.extname(f.originalname).toLowerCase();
      let processed;
      if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        processed = await processImage(f);
      } else {
        processed = await processVideo(f);
      }
      if (processed) media.push(processed);
    }

    const shouldSpotlight = parseBoolean(req.body.spotlight, false);

    const newProject = {
      title: req.body.title,
      description: req.body.description || "",
      category: normalizeCategoryInput(req.body.category),
      client: normalizeClientInput(req.body.client),
      media,
      spotlight: shouldSpotlight,
    };
    projects.push(newProject);
    if (shouldSpotlight) {
      applySpotlightStatus(projects, projects.length - 1, true);
    }
    saveProjects(projects);
    res.json({ ok: true, project: newProject });
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT update (text + add/remove media)
app.put("/api/projects/:index", requireAdmin, upload.array("newMedia", 20), async (req, res) => {
  try {
    const i = parseInt(req.params.index, 10);
    const projects = readProjects();
    if (isNaN(i) || i < 0 || i >= projects.length) return res.status(404).json({ ok: false, error: "Project not found" });

    const proj = projects[i];

    // 1) update text
    if (typeof req.body.title === "string")       proj.title = req.body.title;
    if (typeof req.body.description === "string") proj.description = req.body.description;
    if (typeof req.body.category === "string")    proj.category = normalizeCategoryInput(req.body.category);
    if (typeof req.body.client === "string")      proj.client = normalizeClientInput(req.body.client);

    if (typeof req.body.spotlight !== "undefined") {
      const enableSpotlight = parseBoolean(req.body.spotlight, false);
      if (enableSpotlight) {
        applySpotlightStatus(projects, i, true);
      } else {
        proj.spotlight = false;
      }
    }

    // 2) remove media (delete from disk)
    let removed = [];
    try { removed = JSON.parse(req.body.removed || "[]"); } catch { removed = []; }
    if (!Array.isArray(removed)) removed = [];

    // remove from JSON
    const removedSet = new Set(removed.map(r => r.url));
    proj.media = (proj.media || []).filter(m => !removedSet.has(m.url));

    // delete files from disk
    await Promise.all(
      removed.map(async (m) => {
        await deleteCloudinaryAsset(m);
        if (m.url) safeUnlink(m.url);
        if (m.thumbnail) safeUnlink(m.thumbnail);
      })
    );

    // 3) add new uploads
    for (const f of req.files || []) {
      const ext = path.extname(f.originalname).toLowerCase();
      let processed;
      if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        processed = await processImage(f);
      } else {
        processed = await processVideo(f);
      }
      if (processed) proj.media.push(processed);
    }

    saveProjects(projects);
    res.json({ ok: true, project: proj });
  } catch (err) {
    console.error("❌ Edit error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/projects/:index/spotlight", requireAdmin, (req, res) => {
  try {
    const i = parseInt(req.params.index, 10);
    const projects = readProjects();
    const shouldEnable = parseBoolean(req.body?.spotlight, true);
    const updated = applySpotlightStatus(projects, i, shouldEnable);
    if (!updated) return res.status(404).json({ ok: false, error: "Project not found" });

    saveProjects(projects);
    res.json({
      ok: true,
      project: updated,
      spotlightIndex: shouldEnable ? i : null,
    });
  } catch (err) {
    console.error("Spotlight update error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/projects/spotlight", requireAdmin, (req, res) => {
  try {
    const i = parseInt(req.body?.index, 10);
    const projects = readProjects();
    const shouldEnable = parseBoolean(req.body?.spotlight, true);
    const updated = applySpotlightStatus(projects, i, shouldEnable);
    if (!updated) return res.status(404).json({ ok: false, error: "Project not found" });

    saveProjects(projects);
    res.json({
      ok: true,
      project: updated,
      spotlightIndex: shouldEnable ? i : null,
    });
  } catch (err) {
    console.error("Spotlight update error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE project (also deletes all media files from disk or cloud)
app.delete("/api/projects/:index", requireAdmin, async (req, res) => {
  try {
    const i = parseInt(req.params.index, 10);
    const projects = readProjects();
    if (isNaN(i) || i < 0 || i >= projects.length) {
      return res.status(404).json({ ok: false, error: "Project not found" });
    }

    const removed = projects.splice(i, 1)[0];
    saveProjects(projects);

    await Promise.all(
      (removed.media || []).map(async (m) => {
        await deleteCloudinaryAsset(m);
        if (m?.url) safeUnlink(m.url);
        if (m?.thumbnail) safeUnlink(m.thumbnail);
      })
    );

    res.json({ ok: true, removed });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
// ---------- Auth + Static ----------
app.get("/admin-login.html", (_req, res) => {
  res.sendFile(path.resolve("public", "admin-login.html"));
});

app.get("/admin-login", (_req, res) => {
  res.redirect("/admin-login.html");
});

app.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    setAdminCookie(res, "1");
    return res.redirect("/admin.html");
  }
  setAdminCookie(res, "", { maxAge: 0 });
  return res.redirect("/admin-login.html?error=1");
});

app.post("/admin/logout", (req, res) => {
  setAdminCookie(res, "", { maxAge: 0 });
  res.redirect("/admin-login.html?loggedOut=1");
});

app.get("/admin/logout", (req, res) => {
  setAdminCookie(res, "", { maxAge: 0 });
  res.redirect("/admin-login.html?loggedOut=1");
});

app.get("/admin/logout.html", (req, res) => {
  setAdminCookie(res, "", { maxAge: 0 });
  res.redirect("/admin-login.html?loggedOut=1");
});

app.get("/admin.html", requireAdmin, (_req, res) => {
  res.sendFile(path.resolve("public", "admin.html"));
});

app.get("/p/:shareId", (req, res) => {
  try {
    const projects = readProjects();
    const { project, index } = findProjectByShareId(projects, req.params.shareId);
    if (!project) {
      return res.redirect("/");
    }

    const title = (project.title || "Movil Project").trim() || "Movil Project";
    const rawDescription = (project.description || "").replace(/\s+/g, " ").trim();
    const fallbackDescription = "Explore more projects crafted by Movil.";
    const descriptionSource = rawDescription || fallbackDescription;
    const maxDescriptionLength = 200;
    const description =
      descriptionSource.length > maxDescriptionLength
        ? `${descriptionSource.slice(0, maxDescriptionLength - 3).trimEnd()}...`
        : descriptionSource;

    const imageUrl = makeAbsoluteUrl(req, getProjectShareImage(project));
    const secureImageUrl = imageUrl.replace(/^http:\/\//i, "https://");
    const imageExt = path.extname(secureImageUrl).toLowerCase();
    const imageType =
      imageExt === ".png"
        ? "image/png"
        : imageExt === ".webp"
        ? "image/webp"
        : imageExt === ".gif"
        ? "image/gif"
        : "image/jpeg";
    const canonicalId = buildProjectShareId(project, index);
    const canonicalPath = `/p/${canonicalId}`;
    const canonicalUrl = makeAbsoluteUrl(req, canonicalPath);
    const redirectPath = `/#project-${index}`;
    const redirectUrl = makeAbsoluteUrl(req, redirectPath);

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Movil</title>
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Movil" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(secureImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(secureImageUrl)}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="${imageType}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(secureImageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(title)}" />
  </head>
  <body>
    <script>
      window.location.replace(${JSON.stringify(redirectUrl)});
    </script>
    <noscript>
      <p>Redirecting to project…</p>
      <p><a href="${escapeHtml(redirectUrl)}">Click here if you are not redirected automatically.</a></p>
    </noscript>
  </body>
</html>`;

    res.send(html);
  } catch (err) {
    console.error("Project share page error:", err);
    res.redirect("/");
  }
});

app.use("/uploads", express.static("public/uploads"));
app.use(express.static("public"));

ensureDefaultVideoThumb().catch((err) => {
  console.warn("Default video thumbnail not generated at startup:", err?.message || err);
});
refreshMissingVideoThumbs().catch((err) => {
  console.warn("Video thumbnail refresh skipped:", err?.message || err);
});

// ---------- Catch-all (keeps /api/ from returning HTML) ----------
app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "API route not found" });
  }
  res.sendFile(path.resolve("public", "index.html"));
});

// ---------- Start ----------
const handler = (req, res) => app(req, res);

if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

export default handler;


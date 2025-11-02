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
const PORT = Number(process.env.PORT) || 3000;
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
const disableThumbFlag = (process.env.DISABLE_VIDEO_THUMBNAILS || "").trim().toLowerCase();
const DISABLE_VIDEO_THUMBNAILS = !["0", "false", "no", "off"].includes(disableThumbFlag);

if (CLOUDINARY_HAS_CLOUD) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET || undefined,
    secure: true,
  });
}

const PUBLIC_DIR = path.resolve("public");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join("public", "uploads"));
const TEMP_UPLOAD_DIR = path.resolve(
  process.env.TEMP_UPLOAD_DIR || path.join(os.tmpdir(), "movil-uploads")
);
const DATA_FILE = path.resolve(process.env.DATA_FILE_PATH || "projects.json");
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
  const rel = urlPath.replace(/^\/+uploads\/+/ , "");
  const abs = path.resolve(UPLOAD_DIR, rel);
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
  if (DISABLE_VIDEO_THUMBNAILS) return null;
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
  if (DISABLE_VIDEO_THUMBNAILS) {
    return { path: DEFAULT_VIDEO_THUMB, url: DEFAULT_VIDEO_THUMB_URL };
  }
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

// ... rest of file identical ...

const IS_SERVERLESS_ENV = process.env.VERCEL === "1";

if (!IS_SERVERLESS_ENV) {
  app.use("/uploads", express.static(UPLOAD_DIR));
  app.use(express.static(PUBLIC_DIR));
}

ensureDefaultVideoThumb().catch((err) => {
  console.warn("Default video thumbnail not generated at startup:", err?.message || err);
});
refreshMissingVideoThumbs().catch((err) => {
  console.warn("Video thumbnail refresh skipped:", err?.message || err);
});

app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "API route not found" });
  }
  res.sendFile(path.resolve(PUBLIC_DIR, "index.html"));
});

if (!IS_SERVERLESS_ENV) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

export default app;

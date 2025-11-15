import fs from "node:fs/promises";
import path from "node:path";
import {
  CLOUDINARY_UPLOAD_FOLDER,
  HERO_SETTINGS_FILE_PATH,
  CLOUDINARY_HERO_SETTINGS_ID,
  PROJECTS_STORAGE,
} from "./env.js";
import { CLOUDINARY_ENABLED, cloudinary } from "./cloudinary.js";
import { sanitizeIncomingMediaEntry } from "./projects.js";

const settingsFolder = (
  process.env.CLOUDINARY_SETTINGS_FOLDER ||
  `${CLOUDINARY_UPLOAD_FOLDER.replace(/\/+$/, "")}-data`
).replace(/^\/+|\/+$/g, "");

const HERO_SETTINGS_PUBLIC_ID = (
  CLOUDINARY_HERO_SETTINGS_ID || `${settingsFolder}/hero-settings.json`
).replace(/^\/+/, "");

let cache = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5_000;

const DEFAULT_HERO_DESKTOP_DISPLAY = { x: 50, y: 50, zoom: 1 };
const DEFAULT_HERO_MOBILE_DISPLAY = { x: 50, y: 35, zoom: 1.05 };

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value * 100) / 100;
}

function clampZoom(value) {
  if (!Number.isFinite(value)) return null;
  const min = 0.8;
  const max = 2.2;
  if (value < min) return min;
  if (value > max) return max;
  return Math.round(value * 100) / 100;
}

function normalizeDisplayEntry(entry = {}, defaults) {
  const x = clampPercent(Number(entry?.x));
  const y = clampPercent(Number(entry?.y));
  const zoom = clampZoom(Number(entry?.zoom));
  return {
    x: x ?? defaults.x,
    y: y ?? defaults.y,
    zoom: zoom ?? defaults.zoom,
  };
}

function normalizeHeroVideoDisplay(entry = {}) {
  return {
    desktop: normalizeDisplayEntry(entry.desktop, DEFAULT_HERO_DESKTOP_DISPLAY),
    mobile: normalizeDisplayEntry(entry.mobile, DEFAULT_HERO_MOBILE_DISPLAY),
  };
}

function normalizeHeroVideo(entry) {
  if (!entry) return null;
  const sanitized = sanitizeIncomingMediaEntry(entry);
  if (!sanitized) return null;
  if (sanitized.type !== "video") {
    throw new Error("Hero background requires a video file.");
  }
  const display = normalizeHeroVideoDisplay(entry.display);
  return {
    ...sanitized,
    updatedAt: entry?.updatedAt || new Date().toISOString(),
    display,
  };
}

function normalizeSettings(raw = {}) {
  const base = typeof raw === "object" && raw ? raw : {};
  let heroVideo = null;
  try {
    heroVideo = normalizeHeroVideo(base.heroVideo);
  } catch (err) {
    console.warn("Hero video normalization failed:", err?.message || err);
    heroVideo = null;
  }
  return { heroVideo };
}

async function fetchFromCloudinary() {
  if (!CLOUDINARY_ENABLED) return null;
  try {
    const resource = await cloudinary.api.resource(HERO_SETTINGS_PUBLIC_ID, {
      resource_type: "raw",
    });
    if (!resource?.secure_url) return null;
    const response = await fetch(resource.secure_url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Hero settings fetch failed (${response.status})`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    const code = err?.http_code || err?.status || err?.error?.http_code;
    const message = err?.message || err?.error?.message || "";
    if (code === 404 || /not found/i.test(message)) {
      return null;
    }
    throw err;
  }
}

async function saveToCloudinary(settings) {
  const payload = JSON.stringify(settings, null, 2);
  await new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: HERO_SETTINGS_PUBLIC_ID,
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
    const json = await fs.readFile(path.resolve(HERO_SETTINGS_FILE_PATH), "utf8");
    return JSON.parse(json);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function saveToFile(settings) {
  const payload = JSON.stringify(settings, null, 2);
  await fs.writeFile(path.resolve(HERO_SETTINGS_FILE_PATH), payload, "utf8");
}

async function readSettings({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }
  const raw =
    PROJECTS_STORAGE === "cloudinary" ? await fetchFromCloudinary() : await fetchFromFile();
  const normalized = normalizeSettings(raw || {});
  cache = normalized;
  cacheTime = now;
  return normalized;
}

async function persistSettings(settings) {
  if (PROJECTS_STORAGE === "cloudinary") {
    await saveToCloudinary(settings);
  } else {
    await saveToFile(settings);
  }
  cache = settings;
  cacheTime = Date.now();
  return settings;
}

export async function getSiteSettings(options) {
  return readSettings(options);
}

export async function getHeroVideo(options) {
  const settings = await readSettings(options);
  return settings.heroVideo || null;
}

export async function updateHeroVideo(entry) {
  const normalizedVideo = normalizeHeroVideo(entry);
  if (!normalizedVideo) {
    throw new Error("A valid video asset is required.");
  }
  const current = await readSettings();
  const next = { ...current, heroVideo: normalizedVideo };
  await persistSettings(next);
  return normalizedVideo;
}

export async function clearHeroVideo() {
  const current = await readSettings();
  const next = { ...current, heroVideo: null };
  await persistSettings(next);
  return null;
}

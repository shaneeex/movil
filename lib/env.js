import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
  dotenv.config({ path: ".env.local", override: true });
}

export const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "movilstudio!").trim();
export const ADMIN_SESSION_SECRET =
  (process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "movilstudio!").trim();

export const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
export const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
export const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
export const CLOUDINARY_UPLOAD_FOLDER = (process.env.CLOUDINARY_UPLOAD_FOLDER || "movil/projects").trim();
export const CLOUDINARY_UNSIGNED_PRESET = (process.env.CLOUDINARY_UNSIGNED_PRESET || "").trim();

export const VERCEL_ANALYTICS_TOKEN = (process.env.VERCEL_ANALYTICS_TOKEN || "").trim();
export const HERO_SETTINGS_FILE_PATH = (process.env.HERO_SETTINGS_FILE_PATH || "hero-settings.json").trim();
export const CLOUDINARY_HERO_SETTINGS_ID = (process.env.CLOUDINARY_HERO_SETTINGS_ID || "").trim();

const rawProjectsStorage = process.env.PROJECTS_STORAGE || (process.env.VERCEL ? "cloudinary" : "file");
export const PROJECTS_STORAGE = rawProjectsStorage.toLowerCase() === "cloudinary" ? "cloudinary" : "file";

export const DATA_FILE_PATH = process.env.DATA_FILE_PATH || "projects.json";
export const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 150);

export const SITE_ORIGIN =
  process.env.SITE_ORIGIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

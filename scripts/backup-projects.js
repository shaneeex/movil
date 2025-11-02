import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

const isServerless = process.env.VERCEL === "1";
const storagePref =
  process.env.PROJECTS_STORAGE || (isServerless ? "cloudinary" : "file");
const useCloudinary = storagePref.trim().toLowerCase() === "cloudinary";

async function loadProjects() {
  if (!useCloudinary) {
    const dataFile = path.resolve(process.env.DATA_FILE_PATH || "projects.json");
    if (!fs.existsSync(dataFile)) {
      throw new Error(`Cannot find data file at ${dataFile}`);
    }
    const json = fs.readFileSync(dataFile, "utf8");
    return json.trim() ? JSON.parse(json) : [];
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary credentials are required to back up projects from Cloudinary.");
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  const uploadFolder = process.env.CLOUDINARY_UPLOAD_FOLDER || "movil/projects";
  const baseFolder =
    process.env.CLOUDINARY_PROJECTS_FOLDER ||
    `${uploadFolder.replace(/\/+$/, "")}-data`;
  const publicId = (
    process.env.CLOUDINARY_PROJECTS_ID ||
    `${baseFolder.replace(/^\/+|\/+$/g, "")}/projects.json`
  ).replace(/^\/+/, "");

  const resource = await cloudinary.api.resource(publicId, { resource_type: "raw" });
  if (!resource?.secure_url) {
    return [];
  }
  const response = await fetch(resource.secure_url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Cloudinary returned ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : [];
}

const backupDir = path.resolve("backups");
fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupName = `projects-backup-${timestamp}.json`;
const backupPath = path.join(backupDir, backupName);

try {
  const projects = await loadProjects();
  fs.writeFileSync(backupPath, JSON.stringify(projects, null, 2), "utf8");
  console.log(`Projects backup written to ${backupPath}`);
} catch (err) {
  console.error("Backup failed:", err?.message || err);
  process.exit(1);
}

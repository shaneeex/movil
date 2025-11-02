import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

const dataFile = path.resolve(process.env.DATA_FILE_PATH || "projects.json");
if (!fs.existsSync(dataFile)) {
  console.error(`Cannot find data file at ${dataFile}`);
  process.exit(1);
}

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error("Cloudinary credentials (cloud name, API key, API secret) are required.");
  process.exit(1);
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

const raw = fs.readFileSync(dataFile, "utf8");
const projects = raw.trim() ? JSON.parse(raw) : [];
const payload = JSON.stringify(projects, null, 2);

try {
  await new Promise((resolve, reject) => {
    const uploadOptions = {
      resource_type: "raw",
      public_id: publicId,
      overwrite: true,
    };
    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error) => {
      if (error) return reject(error);
      resolve();
    });
    stream.end(Buffer.from(payload, "utf8"));
  });
  console.log(`Uploaded projects.json to Cloudinary as ${publicId}`);
} catch (err) {
  console.error("Upload failed:", err?.message || err);
  process.exit(1);
}

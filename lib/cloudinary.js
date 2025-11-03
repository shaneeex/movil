import { v2 as cloudinary } from "cloudinary";
import {
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_FOLDER,
  PROJECTS_STORAGE,
} from "./env.js";

export const CLOUDINARY_ENABLED =
  Boolean(CLOUDINARY_CLOUD_NAME) && Boolean(CLOUDINARY_API_KEY) && Boolean(CLOUDINARY_API_SECRET);

if (CLOUDINARY_ENABLED) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
} else if (PROJECTS_STORAGE === "cloudinary") {
  throw new Error(
    "Cloudinary credentials are required but missing. Provide CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
  );
}

export function buildCloudinaryUrl(publicId, { resourceType = "image", width = 640, height = 360 } = {}) {
  if (!publicId || !CLOUDINARY_ENABLED) return null;
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    format: "jpg",
    transformation: [
      { width, height, crop: "fill", gravity: "auto" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
}

export function cloudinaryUploadStream({
  resourceType = "auto",
  folder = CLOUDINARY_UPLOAD_FOLDER,
  chunkSize,
} = {}) {
  if (!CLOUDINARY_ENABLED) {
    throw new Error("Cloudinary is not configured.");
  }
  return cloudinary.uploader.upload_stream.bind(cloudinary.uploader, {
    resource_type: resourceType,
    folder,
    overwrite: false,
    unique_filename: true,
    chunk_size: chunkSize,
  });
}

export async function deleteCloudinaryAsset(publicId, resourceType = "image") {
  if (!CLOUDINARY_ENABLED || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      invalidate: true,
    });
  } catch (err) {
    console.warn("Cloudinary delete failed:", err?.message || err);
  }
}

export { cloudinary };

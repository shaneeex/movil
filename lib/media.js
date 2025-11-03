import { cloudinary, CLOUDINARY_ENABLED, cloudinaryUploadStream, buildCloudinaryUrl } from "./cloudinary.js";

export function detectResourceType(mimeType = "") {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith("video/")) return "video";
  if (lower.startsWith("image/")) return "image";
  return "auto";
}

export async function uploadMediaStream({ file, filename, mimeType }) {
  if (!CLOUDINARY_ENABLED) {
    throw new Error("Cloudinary is required for media uploads on Vercel.");
  }

  const resourceHint = detectResourceType(mimeType);
  const resourceType = resourceHint === "video" ? "video" : resourceHint;
  const chunkSize = resourceType === "video" ? 6_000_000 : undefined;
  const upload = cloudinaryUploadStream({ resourceType, chunkSize });

  return new Promise((resolve, reject) => {
    const stream = upload((error, result) => {
      if (error) {
        console.error("Cloudinary upload failed:", error?.message || error);
        return reject(error);
      }
      if (!result?.secure_url) return reject(new Error("Cloudinary did not return a URL"));

      const resultingType = result.resource_type || (resourceType === "video" ? "video" : "image");
      const publicId = result.public_id;
      const baseUrl = result.secure_url;

      const media = {
        url: baseUrl,
        type: resultingType === "video" ? "video" : "image",
        thumbnail:
          resultingType === "image"
            ? buildCloudinaryUrl(publicId, { resourceType: "image", width: 720, height: 480 }) || baseUrl
            : buildCloudinaryUrl(publicId, { resourceType: "video", width: 640, height: 360 }) || baseUrl,
        cloudinaryId: publicId,
        cloudinaryResourceType: resultingType,
        originalFilename: filename,
      };

      resolve(media);
    });

    stream.on("error", (err) => {
      console.error("Cloudinary stream error:", err?.message || err);
      reject(err);
    });

    file.once("limit", () => {
      const error = new Error("Upload exceeds maximum allowed size");
      error.code = "LIMIT_FILE_SIZE";
      file.unpipe(stream);
      stream.destroy(error);
      reject(error);
    });

    file.on("error", (err) => {
      stream.destroy(err);
      reject(err);
    });

    file.pipe(stream);
  });
}

export async function deleteMedia(media) {
  if (!media?.cloudinaryId) return;
  try {
    await cloudinary.uploader.destroy(media.cloudinaryId, {
      resource_type: media.cloudinaryResourceType || (media.type === "video" ? "video" : "image"),
      invalidate: true,
    });
  } catch (err) {
    console.warn("Failed to delete Cloudinary asset:", err?.message || err);
  }
}

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
  const upload = cloudinaryUploadStream({ resourceType: resourceHint });

  return new Promise((resolve, reject) => {
    const stream = upload((error, result) => {
      if (error) return reject(error);
      if (!result?.secure_url) return reject(new Error("Cloudinary did not return a URL"));

      const resourceType = result.resource_type || (resourceHint === "video" ? "video" : "image");
      const publicId = result.public_id;
      const baseUrl = result.secure_url;

      const media = {
        url: baseUrl,
        type: resourceType === "video" ? "video" : "image",
        thumbnail:
          resourceType === "image"
            ? buildCloudinaryUrl(publicId, { resourceType: "image", width: 720, height: 480 }) || baseUrl
            : buildCloudinaryUrl(publicId, { resourceType: "video", width: 640, height: 360 }) || baseUrl,
        cloudinaryId: publicId,
        cloudinaryResourceType: resourceType,
        originalFilename: filename,
      };

      resolve(media);
    });

    file.on("error", reject);
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

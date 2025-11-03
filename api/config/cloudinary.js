import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UNSIGNED_PRESET, CLOUDINARY_UPLOAD_FOLDER } from "../../lib/env.js";

export default withErrorHandling(async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UNSIGNED_PRESET) {
    return sendJSON(res, 503, {
      ok: false,
      error: "Cloudinary unsigned upload preset is not configured.",
    });
  }

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  return sendJSON(res, 200, {
    ok: true,
    cloudName: CLOUDINARY_CLOUD_NAME,
    uploadPreset: CLOUDINARY_UNSIGNED_PRESET,
    folder: CLOUDINARY_UPLOAD_FOLDER || undefined,
  });
});


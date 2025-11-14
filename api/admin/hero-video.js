import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { parseJsonBody } from "../../lib/multipart.js";
import { getHeroVideo, updateHeroVideo, clearHeroVideo } from "../../lib/site-settings.js";

export default withErrorHandling(async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const heroVideo = await getHeroVideo({ force: true });
    res.setHeader("Cache-Control", "no-store");
    return sendJSON(res, 200, { ok: true, heroVideo });
  }

  if (req.method === "POST") {
    const body = await parseJsonBody(req);
    const candidate = body?.heroVideo || body?.media;
    if (!candidate) {
      return sendJSON(res, 400, { ok: false, error: "A media payload is required." });
    }
    const heroVideo = await updateHeroVideo(candidate);
    res.setHeader("Cache-Control", "no-store");
    return sendJSON(res, 200, { ok: true, heroVideo });
  }

  if (req.method === "DELETE") {
    await clearHeroVideo();
    res.setHeader("Cache-Control", "no-store");
    return sendJSON(res, 200, { ok: true, heroVideo: null });
  }

  return methodNotAllowed(res, ["GET", "POST", "DELETE"]);
});

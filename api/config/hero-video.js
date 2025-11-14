import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { getHeroVideo } from "../../lib/site-settings.js";

export default withErrorHandling(async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  const heroVideo = await getHeroVideo();
  res.setHeader("Cache-Control", heroVideo ? "public, max-age=30, s-maxage=120" : "public, max-age=5");
  return sendJSON(res, 200, { ok: true, heroVideo: heroVideo || null });
});

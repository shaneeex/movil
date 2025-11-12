import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { VERCEL_ANALYTICS_TOKEN } from "../../lib/env.js";

const handler = withErrorHandling(async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  if (!VERCEL_ANALYTICS_TOKEN) {
    return sendJSON(res, 404, { ok: false, error: "Analytics token is not configured." });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  return sendJSON(res, 200, { ok: true, token: VERCEL_ANALYTICS_TOKEN });
});

export default handler;

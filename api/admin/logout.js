
import { withErrorHandling, sendJSON, methodNotAllowed } from "../../lib/http.js";
import { clearAdminCookie } from "../../lib/auth.js";

export default withErrorHandling(async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return methodNotAllowed(res, ["GET", "POST"]);
  }

  clearAdminCookie(res);

  if (req.headers["accept"]?.includes("application/json")) {
    return sendJSON(res, 200, { ok: true });
  }

  res.statusCode = req.method === "GET" ? 302 : 303;
  res.setHeader("Location", "/admin-login.html?loggedOut=1");
  res.end();
});

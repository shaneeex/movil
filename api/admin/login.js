
import { sendJSON, methodNotAllowed, withErrorHandling } from "../../lib/http.js";
import { setAdminCookie } from "../../lib/auth.js";
import { ADMIN_PASSWORD } from "../../lib/env.js";
import { parseUrlEncodedBody, parseJsonBody } from "../../lib/multipart.js";

export default withErrorHandling(async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  const contentType = req.headers["content-type"] || "";
  let body = {};
  if (contentType.includes("application/json")) {
    body = await parseJsonBody(req);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    body = await parseUrlEncodedBody(req);
  } else {
    body = await parseUrlEncodedBody(req);
  }

  const password = (body.password || "").trim();
  if (password && password === ADMIN_PASSWORD) {
    setAdminCookie(res);
    if (req.headers["accept"]?.includes("application/json")) {
      return sendJSON(res, 200, { ok: true });
    }
    res.statusCode = 302;
    res.setHeader("Location", "/admin.html");
    return res.end();
  }

  if (req.headers["accept"]?.includes("application/json")) {
    return sendJSON(res, 401, { ok: false, error: "Invalid password" });
  }

  res.statusCode = 302;
  res.setHeader("Location", "/admin-login.html?error=1");
  res.end();
});

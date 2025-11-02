
import { sendJSON, withErrorHandling } from "../../lib/http.js";
import { isAdminRequest } from "../../lib/auth.js";

export default withErrorHandling(async function handler(req, res) {
  if (isAdminRequest(req)) {
    return sendJSON(res, 200, { ok: true });
  }
  sendJSON(res, 401, { ok: false });
});

export function sendJSON(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export function methodNotAllowed(res, methods = ["GET"]) {
  res.setHeader("Allow", methods.join(", "));
  sendJSON(res, 405, { ok: false, error: "Method Not Allowed" });
}

export function notFound(res) {
  sendJSON(res, 404, { ok: false, error: "Not Found" });
}

export function withErrorHandling(handler) {
  return async function wrapped(req, res) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("API error:", err);
      sendJSON(res, 500, { ok: false, error: err?.message || "Internal Server Error" });
    }
  };
}

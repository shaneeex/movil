import app from "../server.js";

export default function vercelExpressBridge(req, res) {
  try {
    const forwardedPath =
      req.headers["x-vercel-forwarded-path"] ||
      req.headers["x-forwarded-path"];

    if (forwardedPath) {
      req.url = forwardedPath;
      req.originalUrl = forwardedPath;
    } else {
      const origin = `http://${req.headers.host || "localhost"}`;
      const url = new URL(req.url, origin);
      const pathParam = url.searchParams.get("path");
      if (pathParam) {
        const decodedPath = decodeURIComponent(pathParam);
        url.searchParams.delete("path");
        const remainingQuery = url.searchParams.toString();
        const normalized = decodedPath + (remainingQuery ? `?${remainingQuery}` : "");
        req.url = normalized;
        req.originalUrl = normalized;
      }
    }
  } catch (err) {
    console.warn("Failed to normalize Vercel request path:", err?.message || err);
  }

  return app(req, res);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

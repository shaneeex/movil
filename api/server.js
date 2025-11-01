import app from "../server.js";

export default function vercelExpressBridge(req, res) {
  try {
    const forwardedPath =
      req.headers["x-vercel-forwarded-path"] ||
      req.headers["x-forwarded-path"] ||
      req.headers["x-original-uri"];

    if (forwardedPath) {
      req.url = forwardedPath;
      req.originalUrl = forwardedPath;
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

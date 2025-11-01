import app from "../server.js";

export default function vercelExpressBridge(req, res) {
  try {
    const origin = http://;
    const url = new URL(req.url, origin);
    const pathParam = url.searchParams.get("path");
    if (pathParam) {
      const decodedPath = decodeURIComponent(pathParam);
      url.searchParams.delete("path");
      const remainingQuery = url.searchParams.toString();
      req.url = decodedPath + (remainingQuery ? ? : "");
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

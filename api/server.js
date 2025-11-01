import handler from "../server.js";

export default function vercelExpressBridge(req, res) {
  try {
    const origin = `http://${req.headers.host || "localhost"}`;
    const url = new URL(req.url, origin);
    const pathParam = url.searchParams.get("path");
    if (pathParam) {
      const decodedPath = decodeURIComponent(pathParam);
      url.searchParams.delete("path");
      const remainingQuery = url.searchParams.toString();
      req.url = decodedPath + (remainingQuery ? `?${remainingQuery}` : "");
    }
  } catch (err) {
    console.warn("Failed to normalize Vercel request path:", err?.message || err);
  }
  return handler(req, res);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

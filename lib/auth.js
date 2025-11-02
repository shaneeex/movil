import crypto from "node:crypto";
import { ADMIN_PASSWORD, ADMIN_SESSION_SECRET } from "./env.js";

const ADMIN_COOKIE = "admin_token";
const TOKEN_VALUE = crypto
  .createHmac("sha256", ADMIN_SESSION_SECRET || "movilstudio")
  .update(ADMIN_PASSWORD || "movilstudio")
  .digest("hex");

const COOKIE_BASE = `${ADMIN_COOKIE}=${TOKEN_VALUE}; Path=/; HttpOnly; SameSite=Lax`;

export function parseCookies(header = "") {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split("=");
      acc[key] = decodeURIComponent(rest.join("=") || "");
      return acc;
    }, {});
}

export function isAdminRequest(req) {
  const cookies = parseCookies(req.headers?.cookie || "");
  return cookies[ADMIN_COOKIE] === TOKEN_VALUE;
}

export function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  return false;
}

export function setAdminCookie(res) {
  const secure = res.req?.headers["x-forwarded-proto"] === "https" || process.env.VERCEL === "1";
  res.setHeader("Set-Cookie", `${COOKIE_BASE}${secure ? "; Secure" : ""}; Max-Age=${60 * 60 * 6}`);
}

export function clearAdminCookie(res) {
  const secure = res.req?.headers["x-forwarded-proto"] === "https" || process.env.VERCEL === "1";
  res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
}

export function respondUnauthorized(res) {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
}

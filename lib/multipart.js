import Busboy from "busboy";
import { MAX_UPLOAD_SIZE_MB } from "./env.js";

export function parseMultipartForm(req, { onFile } = {}) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const filePromises = [];
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fields: 100,
        files: 20,
        fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
      },
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (fieldname, file, info) => {
      const { filename, mimeType } = info;
      if (!filename) {
        file.resume();
        return;
      }
      if (typeof onFile === "function") {
        const result = onFile({ fieldname, file, filename, mimeType });
        if (result) filePromises.push(Promise.resolve(result));
      } else {
        const chunks = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => {
          filePromises.push(
            Promise.resolve({
              fieldname,
              filename,
              mimeType,
              buffer: Buffer.concat(chunks),
            })
          );
        });
      }

      file.on("error", (err) => reject(err));
    });

    busboy.on("error", (err) => reject(err));

    busboy.on("finish", async () => {
      try {
        const uploads = await Promise.all(filePromises);
        resolve({
          fields,
          files: uploads.filter(Boolean),
        });
      } catch (err) {
        reject(err);
      }
    });

    req.pipe(busboy);
  });
}

export async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export async function parseUrlEncodedBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const params = new URLSearchParams(raw);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

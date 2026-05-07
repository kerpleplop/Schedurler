import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

export async function serveStatic(
  response: ServerResponse,
  uiRoot: string,
  requestedPath: string
): Promise<void> {
  const resolved = path.resolve(uiRoot, requestedPath);

  // Traversal guard: resolved path must stay inside uiRoot
  if (!resolved.startsWith(path.resolve(uiRoot) + path.sep) && resolved !== path.resolve(uiRoot)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  let data: Buffer;
  try {
    data = await readFile(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") {
      response.statusCode = 404;
      response.end("Not found");
      return;
    }
    throw error;
  }

  response.statusCode = 200;
  response.setHeader("content-type", contentType);
  response.end(data);
}

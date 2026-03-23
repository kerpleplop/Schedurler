import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";

const STATIC_ROOT = path.resolve(__dirname, "../../static");
const STATIC_FILES = new Map<string, { filePath: string; contentType: string }>([
  [
    "/",
    {
      filePath: path.join(STATIC_ROOT, "index.html"),
      contentType: "text/html; charset=utf-8"
    }
  ],
  [
    "/assets/app.css",
    {
      filePath: path.join(STATIC_ROOT, "app.css"),
      contentType: "text/css; charset=utf-8"
    }
  ],
  [
    "/assets/app.js",
    {
      filePath: path.join(STATIC_ROOT, "app.js"),
      contentType: "application/javascript; charset=utf-8"
    }
  ]
]);

export async function handleStaticRequest(
  pathname: string,
  response: ServerResponse
): Promise<boolean> {
  const asset = STATIC_FILES.get(pathname);

  if (!asset) {
    return false;
  }

  response.statusCode = 200;
  response.setHeader("content-type", asset.contentType);
  response.end(await readFile(asset.filePath));

  return true;
}

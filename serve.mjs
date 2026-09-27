import http from "node:http";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const rootReal = await realpath(root);
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Deskworlds: invalid PORT ${process.env.PORT}`);
  process.exit(1);
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".mp4": "video/mp4",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
};

// Preview needs the gallery, scenes, shared UI, vendor Three.js and docs media.
// Everything else in the repo (source installer, .git, tools, tests) stays off the wire.
const allowed =
  /^(?:index\.html|(?:ui|vendor|scenes)(?:\/|$)|docs\/(?:images|videos)(?:\/|$))/i;

function withinRoot(candidate, base) {
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
}

function requestPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const trimmed = decoded.split("?")[0].split("#")[0];
  const parts = trimmed.split("/").filter((part) => part.length > 0);
  if (
    parts.some(
      (part) =>
        part === ".." ||
        part.startsWith(".") ||
        part === "node_modules" ||
        part === "tests",
    )
  )
    return null;
  const joined = parts.join("/") || "index.html";
  if (!allowed.test(joined)) return null;
  return joined;
}

async function openFile(rel) {
  const absolute = resolve(rootReal, rel);
  if (!withinRoot(absolute, rootReal)) return null;
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    return null;
  }
  // Refuse to follow a symlink that leaves the project, and refuse symlink dirs.
  if (info.isSymbolicLink()) {
    const target = await realpath(absolute);
    if (!withinRoot(target, rootReal)) return null;
    info = await stat(target);
    if (info.isDirectory()) return null;
    return target;
  }
  if (info.isDirectory()) {
    const index = resolve(absolute, "index.html");
    if (!withinRoot(index, rootReal)) return null;
    const indexReal = await realpath(index).catch(() => null);
    if (!indexReal || !withinRoot(indexReal, rootReal)) return null;
    return indexReal;
  }
  if (!info.isFile()) return null;
  return absolute;
}

const headers = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

http
  .createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...headers, Allow: "GET, HEAD" });
        res.end();
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const rel = requestPath(url.pathname === "/" ? "/index.html" : url.pathname);
      if (!rel) {
        res.writeHead(403, headers);
        res.end("Forbidden");
        return;
      }
      const file = await openFile(rel);
      if (!file) {
        res.writeHead(404, headers);
        res.end("Not found");
        return;
      }
      const data = req.method === "HEAD" ? null : await readFile(file);
      const length = data ? data.length : (await stat(file)).size;
      res.writeHead(200, {
        ...headers,
        "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": length,
      });
      res.end(data);
    } catch {
      res.writeHead(404, headers);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Deskworlds: http://127.0.0.1:${port}`),
  );

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(new URL("../serve.mjs", import.meta.url)));
const port = 18081 + Math.floor(Math.random() * 1000);

function get(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const child = spawn(process.execPath, [join(root, "serve.mjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server start timed out")), 5000);
  child.stdout.on("data", (chunk) => {
    if (String(chunk).includes("Deskworlds:")) {
      clearTimeout(timer);
      resolve();
    }
  });
  child.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`server exited early: ${code}`));
  });
});

try {
  const home = await get("/");
  assert.equal(home.status, 200);
  assert.match(home.headers["content-type"], /text\/html/);
  assert.equal(home.headers["x-content-type-options"], "nosniff");
  assert.equal(home.headers["x-frame-options"], "DENY");

  const scene = await get("/scenes/riverscape/");
  assert.equal(scene.status, 200);

  const vendor = await get("/vendor/three.module.js");
  assert.equal(vendor.status, 200);

  const head = await get("/index.html", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.ok(Number(head.headers["content-length"]) > 0);

  for (const path of [
    "/.git/config",
    "/.git/HEAD",
    "/wallpaper/install.sh",
    "/wallpaper/Wallpaper.swift",
    "/tools/bake-sand.py",
    "/package.json",
    "/../etc/passwd",
    "/%2e%2e/%2e%2e/etc/passwd",
    "/scenes/riverscape/tests/fish-behavior.mjs",
  ]) {
    const response = await get(path);
    assert.ok(
      response.status === 403 || response.status === 404,
      `${path} should be blocked, got ${response.status}`,
    );
    assert.doesNotMatch(response.body.toString(), /\[core\]|repositoryformatversion/);
  }

  const post = await get("/", "POST");
  assert.equal(post.status, 405);

  console.log("serve security checks passed");
} finally {
  child.kill("SIGTERM");
}

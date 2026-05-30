import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "data");
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, "ouyu.sqlite");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ouyu@2026";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();

await mkdir(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    backup_at TEXT NOT NULL
  );
`);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function now() {
  return new Date().toISOString();
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function passwordMatches(input) {
  const left = createHash("sha256").update(String(input || "")).digest();
  const right = createHash("sha256").update(ADMIN_PASSWORD).digest();
  return timingSafeEqual(left, right);
}

function createSession(res) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader("set-cookie", `ouyu_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function clearSession(req, res) {
  const token = parseCookies(req).ouyu_session;
  if (token) sessions.delete(token);
  res.setHeader("set-cookie", "ouyu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function isAuthenticated(req) {
  const token = parseCookies(req).ouyu_session;
  const expires = token ? sessions.get(token) : null;
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function parseRows(table) {
  return db
    .prepare(`SELECT data FROM ${table} ORDER BY updated_at DESC`)
    .all()
    .map(row => JSON.parse(row.data));
}

function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("settings");
  return row ? JSON.parse(row.value) : { theme: "light" };
}

function getBackupAt() {
  const row = db.prepare("SELECT backup_at FROM backups WHERE id = 1").get();
  return row?.backup_at || null;
}

function getState() {
  return {
    rooms: parseRows("rooms"),
    ledger: parseRows("ledger"),
    settings: getSettings(),
    backupAt: getBackupAt(),
    updatedAt: now()
  };
}

function replaceTable(table, rows) {
  const insert = db.prepare(`INSERT INTO ${table} (id, data, updated_at) VALUES (?, ?, ?)`);
  db.exec(`DELETE FROM ${table}`);
  for (const row of rows || []) {
    if (!row.id) continue;
    insert.run(row.id, JSON.stringify(row), now());
  }
}

function saveSettings(settings) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('settings', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(settings || { theme: "light" }), now());
}

function createBackup() {
  const state = getState();
  const backupAt = now();
  db.prepare(`
    INSERT INTO backups (id, data, backup_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, backup_at = excluded.backup_at
  `).run(JSON.stringify({ ...state, backupAt }), backupAt);
  return backupAt;
}

function restoreBackup() {
  const row = db.prepare("SELECT data FROM backups WHERE id = 1").get();
  if (!row) return false;
  const state = JSON.parse(row.data);
  replaceTable("rooms", state.rooms);
  replaceTable("ledger", state.ledger);
  saveSettings(state.settings);
  return true;
}

function importState(state) {
  db.exec("BEGIN");
  try {
    replaceTable("rooms", state.rooms);
    replaceTable("ledger", state.ledger);
    saveSettings(state.settings || { theme: "light" });
    db.exec("COMMIT");
    createBackup();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function clearAll() {
  db.exec("DELETE FROM rooms; DELETE FROM ledger; DELETE FROM settings;");
  saveSettings({ theme: "light" });
  createBackup();
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/login") {
      const { password } = await readJson(req);
      if (!passwordMatches(password)) {
        return jsonResponse(res, 401, { ok: false, error: "密码不正确" });
      }
      createSession(res);
      return jsonResponse(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      clearSession(req, res);
      return jsonResponse(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return jsonResponse(res, 200, { ok: true, authenticated: isAuthenticated(req) });
    }

    if (!isAuthenticated(req)) {
      return jsonResponse(res, 401, { ok: false, error: "请先登录" });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return jsonResponse(res, 200, getState());
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/rooms/")) {
      const room = await readJson(req);
      const id = decodeURIComponent(url.pathname.split("/").pop());
      room.id = id;
      db.prepare(`
        INSERT INTO rooms (id, data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(id, JSON.stringify(room), now());
      createBackup();
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/rooms/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
      createBackup();
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/ledger/")) {
      const item = await readJson(req);
      const id = decodeURIComponent(url.pathname.split("/").pop());
      item.id = id;
      db.prepare(`
        INSERT INTO ledger (id, data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(id, JSON.stringify(item), now());
      createBackup();
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/ledger/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      db.prepare("DELETE FROM ledger WHERE id = ?").run(id);
      createBackup();
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "PUT" && url.pathname === "/api/settings") {
      const settings = await readJson(req);
      saveSettings(settings);
      createBackup();
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "POST" && url.pathname === "/api/import") {
      const state = await readJson(req);
      importState(state);
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "POST" && url.pathname === "/api/backup") {
      const backupAt = createBackup();
      return jsonResponse(res, 200, { ok: true, backupAt, state: getState() });
    }

    if (req.method === "POST" && url.pathname === "/api/backup/restore") {
      const ok = restoreBackup();
      if (!ok) return jsonResponse(res, 404, { ok: false, error: "没有可恢复的备份" });
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    if (req.method === "POST" && url.pathname === "/api/clear") {
      clearAll();
      return jsonResponse(res, 200, { ok: true, state: getState() });
    }

    return jsonResponse(res, 404, { ok: false, error: "接口不存在" });
  } catch (error) {
    return jsonResponse(res, 500, { ok: false, error: error.message || "服务器错误" });
  }
}

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(ROOT, requestPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600"
    });
    res.end(content);
  } catch {
    if (!existsSync(filePath) && !extname(filePath)) {
      const content = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "content-type": mimeTypes[".html"], "cache-control": "no-cache" });
      res.end(content);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`偶域共享数据版已启动：http://localhost:${PORT}`);
  console.log(`局域网访问：把 localhost 换成这台电脑或服务器的内网 IP`);
  console.log(`数据库位置：${DB_PATH}`);
});

/**
 * 偶域租房管理系统 — Cloudflare Worker
 * D1 数据库 + Workers Assets 静态文件
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function now() { return new Date().toISOString(); }
async function readJson(r) { try { return await r.json(); } catch { return {}; } }

// ========== 数据库操作 ==========

function allRows(db, table) {
  const result = db.prepare(`SELECT data FROM ${table} ORDER BY updated_at DESC`).all();
  return (result.results || []).map(r => { try { return JSON.parse(r.data); } catch { return {}; } });
}

function getSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").first();
  if (row?.value) { try { return JSON.parse(row.value); } catch {} }
  return { theme: "light" };
}

function getState(db) {
  return {
    rooms: allRows(db, "rooms"),
    ledger: allRows(db, "ledger"),
    settings: getSettings(db),
    backupAt: (db.prepare("SELECT backup_at FROM backups WHERE id = 1").first())?.backup_at || null,
    updatedAt: now(),
  };
}

function runBackup(db) {
  const state = getState(db);
  const at = now();
  db.prepare("INSERT OR REPLACE INTO backups (id, data, backup_at) VALUES (1, ?, ?)")
    .bind(JSON.stringify({ ...state, backupAt: at }), at).run();
  return at;
}

// ========== API 路由 ==========

async function handleApi(request, db, url) {
  const path = url.pathname;
  try {
    if (request.method === "GET" && path === "/api/state") return json(getState(db));

    if (request.method === "PUT" && path.startsWith("/api/rooms/")) {
      const room = await readJson(request);
      room.id = decodeURIComponent(path.split("/").pop());
      db.prepare(`INSERT OR REPLACE INTO rooms (id, data, updated_at) VALUES (?, ?, ?)`)
        .bind(room.id, JSON.stringify(room), now()).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "DELETE" && path.startsWith("/api/rooms/")) {
      db.prepare("DELETE FROM rooms WHERE id = ?").bind(decodeURIComponent(path.split("/").pop())).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "PUT" && path.startsWith("/api/ledger/")) {
      const item = await readJson(request);
      item.id = decodeURIComponent(path.split("/").pop());
      db.prepare(`INSERT OR REPLACE INTO ledger (id, data, updated_at) VALUES (?, ?, ?)`)
        .bind(item.id, JSON.stringify(item), now()).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "DELETE" && path.startsWith("/api/ledger/")) {
      db.prepare("DELETE FROM ledger WHERE id = ?").bind(decodeURIComponent(path.split("/").pop())).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "PUT" && path === "/api/settings") {
      const s = await readJson(request);
      db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)`)
        .bind(JSON.stringify(s || { theme: "light" }), now()).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "POST" && path === "/api/import") {
      const s = await readJson(request);
      db.prepare("DELETE FROM rooms").run();
      db.prepare("DELETE FROM ledger").run();
      const ins = db.prepare("INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?)");
      for (const r of s.rooms || []) { if (r.id) ins.bind(r.id, JSON.stringify(r), now()).run(); }
      const insL = db.prepare("INSERT INTO ledger (id, data, updated_at) VALUES (?, ?, ?)");
      for (const l of s.ledger || []) { if (l.id) insL.bind(l.id, JSON.stringify(l), now()).run(); }
      db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)`)
        .bind(JSON.stringify(s.settings || { theme: "light" }), now()).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "POST" && path === "/api/backup") {
      return json({ ok: true, backupAt: runBackup(db), state: getState(db) });
    }
    if (request.method === "POST" && path === "/api/backup/restore") {
      const row = db.prepare("SELECT data FROM backups WHERE id = 1").first();
      if (!row) return json({ ok: false, error: "没有可恢复的备份" }, 404);
      const s = JSON.parse(row.data);
      db.prepare("DELETE FROM rooms").run(); db.prepare("DELETE FROM ledger").run();
      const ins = db.prepare("INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?)");
      for (const r of s.rooms || []) { if (r.id) ins.bind(r.id, JSON.stringify(r), now()).run(); }
      const insL = db.prepare("INSERT INTO ledger (id, data, updated_at) VALUES (?, ?, ?)");
      for (const l of s.ledger || []) { if (l.id) insL.bind(l.id, JSON.stringify(l), now()).run(); }
      db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)`)
        .bind(JSON.stringify(s.settings || { theme: "light" }), now()).run();
      return json({ ok: true, state: getState(db) });
    }
    if (request.method === "POST" && path === "/api/clear") {
      db.prepare("DELETE FROM rooms").run();
      db.prepare("DELETE FROM ledger").run();
      db.prepare("DELETE FROM settings").run();
      db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)`)
        .bind(JSON.stringify({ theme: "light" }), now()).run();
      runBackup(db);
      return json({ ok: true, state: getState(db) });
    }
    return json({ ok: false, error: "接口不存在" }, 404);
  } catch (error) {
    return json({ ok: false, error: error.message || "服务器错误" }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type" } });
    }
    if (url.pathname.startsWith("/api/")) {
      if (!env.DB) return json({ ok: false, error: "数据库未配置" }, 500);
      const res = await handleApi(request, env.DB, url);
      res.headers.set("access-control-allow-origin", "*");
      return res;
    }
    return env.ASSETS.fetch(request);
  },
};

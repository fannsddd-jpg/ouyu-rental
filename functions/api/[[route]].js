/**
 * 偶域租房管理系统 — Cloudflare Pages Functions API
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function now() { return new Date().toISOString(); }

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function allRows(db, table) {
  const result = db.prepare(`SELECT data FROM ${table} ORDER BY updated_at DESC`).all();
  return (result.results || []).map((r) => {
    try { return JSON.parse(r.data); } catch { return {}; }
  });
}

function getSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").first();
  if (row && row.value) {
    try { return JSON.parse(row.value); } catch { return { theme: "light" }; }
  }
  return { theme: "light" };
}

function getBackupAt(db) {
  const row = db.prepare("SELECT backup_at FROM backups WHERE id = 1").first();
  return row?.backup_at || null;
}

function getState(db) {
  return {
    rooms: allRows(db, "rooms"),
    ledger: allRows(db, "ledger"),
    settings: getSettings(db),
    backupAt: getBackupAt(db),
    updatedAt: now(),
  };
}

function replaceTable(db, table, rows) {
  db.prepare(`DELETE FROM ${table}`).run();
  const insert = db.prepare(`INSERT INTO ${table} (id, data, updated_at) VALUES (?, ?, ?)`);
  for (const row of rows || []) {
    if (!row.id) continue;
    insert.bind(row.id, JSON.stringify(row), now()).run();
  }
}

function saveSettings(db, settings) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(JSON.stringify(settings || { theme: "light" }), now()).run();
}

function createBackup(db) {
  const state = getState(db);
  const backupAt = now();
  db.prepare(
    `INSERT INTO backups (id, data, backup_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, backup_at = excluded.backup_at`
  ).bind(JSON.stringify({ ...state, backupAt }), backupAt).run();
  return backupAt;
}

function restoreBackup(db) {
  const row = db.prepare("SELECT data FROM backups WHERE id = 1").first();
  if (!row) return false;
  const state = JSON.parse(row.data);
  replaceTable(db, "rooms", state.rooms);
  replaceTable(db, "ledger", state.ledger);
  saveSettings(db, state.settings);
  return true;
}

function importState(db, state) {
  db.prepare("DELETE FROM rooms").run();
  db.prepare("DELETE FROM ledger").run();
  replaceTable(db, "rooms", state.rooms);
  replaceTable(db, "ledger", state.ledger);
  saveSettings(db, state.settings || { theme: "light" });
  createBackup(db);
}

function clearAll(db) {
  db.prepare("DELETE FROM rooms").run();
  db.prepare("DELETE FROM ledger").run();
  db.prepare("DELETE FROM settings").run();
  saveSettings(db, { theme: "light" });
  createBackup(db);
}

async function handleApi(request, db, url) {
  const path = url.pathname;
  try {
    if (request.method === "GET" && path === "/api/state") return json(getState(db));

    if (request.method === "PUT" && path.startsWith("/api/rooms/")) {
      const room = await readJson(request);
      const id = decodeURIComponent(path.split("/").pop());
      room.id = id;
      db.prepare(
        `INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      ).bind(id, JSON.stringify(room), now()).run();
      createBackup(db);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "DELETE" && path.startsWith("/api/rooms/")) {
      const id = decodeURIComponent(path.split("/").pop());
      db.prepare("DELETE FROM rooms WHERE id = ?").bind(id).run();
      createBackup(db);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "PUT" && path.startsWith("/api/ledger/")) {
      const item = await readJson(request);
      const id = decodeURIComponent(path.split("/").pop());
      item.id = id;
      db.prepare(
        `INSERT INTO ledger (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      ).bind(id, JSON.stringify(item), now()).run();
      createBackup(db);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "DELETE" && path.startsWith("/api/ledger/")) {
      const id = decodeURIComponent(path.split("/").pop());
      db.prepare("DELETE FROM ledger WHERE id = ?").bind(id).run();
      createBackup(db);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "PUT" && path === "/api/settings") {
      const settings = await readJson(request);
      saveSettings(db, settings);
      createBackup(db);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "POST" && path === "/api/import") {
      const state = await readJson(request);
      importState(db, state);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "POST" && path === "/api/backup") {
      const backupAt = createBackup(db);
      return json({ ok: true, backupAt, state: getState(db) });
    }

    if (request.method === "POST" && path === "/api/backup/restore") {
      const ok = restoreBackup(db);
      if (!ok) return json({ ok: false, error: "没有可恢复的备份" }, 404);
      return json({ ok: true, state: getState(db) });
    }

    if (request.method === "POST" && path === "/api/clear") {
      clearAll(db);
      return json({ ok: true, state: getState(db) });
    }

    return json({ ok: false, error: "接口不存在" }, 404);
  } catch (error) {
    return json({ ok: false, error: error.message || "服务器错误" }, 500);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (!env.DB) return json({ ok: false, error: "数据库未绑定" }, 500);

  const response = await handleApi(request, env.DB, url);
  response.headers.set("access-control-allow-origin", "*");
  return response;
}

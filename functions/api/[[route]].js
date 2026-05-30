/**
 * 偶域租房管理系统 — Cloudflare Pages Functions API
 */

const ACCOUNT_ID = "4e82fdd75c77d6df055914a02ff05688";
const DB_ID = "3f8f9f07-fc31-40b6-abc1-595e562e7c9d";
const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function now() { return new Date().toISOString(); }
async function readJson(r) { try { return await r.json(); } catch { return {}; } }

// ========== 密码 & 会话 ==========

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function getCookies(request) {
  const cookie = request.headers.get("cookie") || "";
  return Object.fromEntries(cookie.split(";").map(c => c.trim().split("=").map(decodeURIComponent)).filter(p => p.length === 2));
}

const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 小时

async function checkAuth(request, env) {
  const cookies = getCookies(request);
  const token = cookies.ouyu_session;
  if (!token) return false;
  // token 格式: hash:expiry
  const [hash, expiry] = token.split(":");
  if (!hash || !expiry || Date.now() > Number(expiry)) return false;
  const expected = await sha256(env.SITE_PASSWORD + ":" + expiry);
  return hash === expected;
}

async function createSession(env) {
  const expiry = Date.now() + SESSION_TTL;
  const hash = await sha256(env.SITE_PASSWORD + ":" + expiry);
  return `${hash}:${expiry}`;
}

// ========== D1 REST API ==========

async function d1Query(env, sql, params = []) {
  const token = env.CF_API_TOKEN;
  if (!token) throw new Error("API token 未配置");
  const res = await fetch(`${API_BASE}/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || "数据库查询失败");
  return data.result[0];
}

async function allRows(env, table) {
  const r = await d1Query(env, `SELECT data FROM ${table} ORDER BY updated_at DESC`);
  return (r.results || []).map(x => { try { return JSON.parse(x.data); } catch { return {}; } });
}

async function getSettings(env) {
  const r = await d1Query(env, "SELECT value FROM settings WHERE key = ?", ["settings"]);
  if (r.results?.[0]?.value) { try { return JSON.parse(r.results[0].value); } catch {} }
  return { theme: "light" };
}

async function getState(env) {
  const [rooms, ledger, settings] = await Promise.all([allRows(env,"rooms"), allRows(env,"ledger"), getSettings(env)]);
  const r = await d1Query(env, "SELECT backup_at FROM backups WHERE id = 1");
  return { rooms, ledger, settings, backupAt: r.results?.[0]?.backup_at || null, updatedAt: now() };
}

async function execSQL(env, sql, params = []) { return d1Query(env, sql, params); }

async function runBackup(env) {
  const state = await getState(env);
  const at = now();
  await execSQL(env, "INSERT OR REPLACE INTO backups (id, data, backup_at) VALUES (1, ?, ?)", [JSON.stringify({...state,backupAt:at}), at]);
}

// ========== API 路由 ==========

async function handleApi(request, env, url) {
  const path = url.pathname;
  try {
    // --- 公开接口 ---

    if (request.method === "POST" && path === "/api/login") {
      const { password } = await readJson(request);
      if (password !== env.SITE_PASSWORD) {
        return json({ ok: false, error: "密码不正确" }, 401);
      }
      const token = await createSession(env);
      const resp = json({ ok: true });
      resp.headers.set("set-cookie", `ouyu_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL/1000}`);
      return resp;
    }

    if (request.method === "POST" && path === "/api/logout") {
      const resp = json({ ok: true });
      resp.headers.set("set-cookie", "ouyu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      return resp;
    }

    if (request.method === "GET" && path === "/api/me") {
      const ok = await checkAuth(request, env);
      return json({ ok: true, authenticated: ok });
    }

    // --- 需要登录 ---

    if (!(await checkAuth(request, env))) {
      return json({ ok: false, error: "请先登录" }, 401);
    }

    if (request.method === "GET" && path === "/api/state") return json(await getState(env));

    if (request.method === "PUT" && path.startsWith("/api/rooms/")) {
      const room = await readJson(request);
      room.id = decodeURIComponent(path.split("/").pop());
      await execSQL(env, "INSERT OR REPLACE INTO rooms (id, data, updated_at) VALUES (?, ?, ?)", [room.id, JSON.stringify(room), now()]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "DELETE" && path.startsWith("/api/rooms/")) {
      await execSQL(env, "DELETE FROM rooms WHERE id = ?", [decodeURIComponent(path.split("/").pop())]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "PUT" && path.startsWith("/api/ledger/")) {
      const item = await readJson(request);
      item.id = decodeURIComponent(path.split("/").pop());
      await execSQL(env, "INSERT OR REPLACE INTO ledger (id, data, updated_at) VALUES (?, ?, ?)", [item.id, JSON.stringify(item), now()]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "DELETE" && path.startsWith("/api/ledger/")) {
      await execSQL(env, "DELETE FROM ledger WHERE id = ?", [decodeURIComponent(path.split("/").pop())]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "PUT" && path === "/api/settings") {
      const s = await readJson(request);
      await execSQL(env, "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)", [JSON.stringify(s || { theme: "light" }), now()]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "POST" && path === "/api/import") {
      const s = await readJson(request);
      await execSQL(env, "DELETE FROM rooms"); await execSQL(env, "DELETE FROM ledger");
      for (const r of s.rooms || []) { if (r.id) await execSQL(env, "INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?)", [r.id, JSON.stringify(r), now()]); }
      for (const l of s.ledger || []) { if (l.id) await execSQL(env, "INSERT INTO ledger (id, data, updated_at) VALUES (?, ?, ?)", [l.id, JSON.stringify(l), now()]); }
      await execSQL(env, "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)", [JSON.stringify(s.settings || { theme: "light" }), now()]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "POST" && path === "/api/backup") {
      await runBackup(env);
      return json({ ok: true, backupAt: (await d1Query(env, "SELECT backup_at FROM backups WHERE id = 1")).results?.[0]?.backup_at, state: await getState(env) });
    }
    if (request.method === "POST" && path === "/api/backup/restore") {
      const row = (await d1Query(env, "SELECT data FROM backups WHERE id = 1")).results?.[0];
      if (!row) return json({ ok: false, error: "没有可恢复的备份" }, 404);
      const s = JSON.parse(row.data);
      await execSQL(env, "DELETE FROM rooms"); await execSQL(env, "DELETE FROM ledger");
      for (const r of s.rooms || []) { if (r.id) await execSQL(env, "INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?)", [r.id, JSON.stringify(r), now()]); }
      for (const l of s.ledger || []) { if (l.id) await execSQL(env, "INSERT INTO ledger (id, data, updated_at) VALUES (?, ?, ?)", [l.id, JSON.stringify(l), now()]); }
      await execSQL(env, "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)", [JSON.stringify(s.settings || { theme: "light" }), now()]);
      return json({ ok: true, state: await getState(env) });
    }
    if (request.method === "POST" && path === "/api/clear") {
      await execSQL(env, "DELETE FROM rooms"); await execSQL(env, "DELETE FROM ledger"); await execSQL(env, "DELETE FROM settings");
      await execSQL(env, "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('settings', ?, ?)", [JSON.stringify({ theme: "light" }), now()]);
      await runBackup(env);
      return json({ ok: true, state: await getState(env) });
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
    return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type" } });
  }

  if (!env.CF_API_TOKEN) return json({ ok: false, error: "API Token 未配置" }, 500);
  if (!env.SITE_PASSWORD) return json({ ok: false, error: "网站密码未配置" }, 500);

  const response = await handleApi(request, env, url);
  response.headers.set("access-control-allow-origin", "*");
  return response;
}
// deploy-1780119592

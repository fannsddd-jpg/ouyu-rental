export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  function json(d, s) {
    return new Response(JSON.stringify(d), { status: s||200, headers: {"content-type":"application/json; charset=utf-8"} });
  }

  async function sha256(t) {
    const d = new TextEncoder().encode(t);
    const h = await crypto.subtle.digest("SHA-256", d);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,"0")).join("");
  }

  try {
    if (request.method === "POST" && path === "/api/login") {
      let body = {};
      try { body = await request.json(); } catch {}
      if (body.password !== env.SITE_PASSWORD) return json({ ok: false, error: "密码不正确" }, 401);
      const expiry = Date.now() + 12*60*60*1000;
      const hash = await sha256(env.SITE_PASSWORD + ":" + expiry);
      const resp = json({ ok: true });
      resp.headers.set("set-cookie", "ouyu_session="+encodeURIComponent(hash+":"+expiry)+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200");
      return resp;
    }
    if (request.method === "POST" && path === "/api/logout") {
      const resp = json({ ok: true });
      resp.headers.set("set-cookie", "ouyu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      return resp;
    }
    if (request.method === "GET" && path === "/api/me") {
      const c = request.headers.get("cookie") || "";
      const cookies = Object.fromEntries(c.split(";").map(x => x.trim().split("=").map(decodeURIComponent)).filter(p => p.length===2));
      const token = cookies.ouyu_session;
      let ok = false;
      if (token) {
        const [hash, expiry] = token.split(":");
        if (hash && expiry && Date.now() <= Number(expiry)) {
          ok = hash === await sha256(env.SITE_PASSWORD + ":" + expiry);
        }
      }
      return json({ ok: true, authenticated: ok });
    }
    return context.next();
  } catch(e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

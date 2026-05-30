export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "方法不允许" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  let body = {};
  try { body = await request.json(); } catch {}
  if (body.password !== env.SITE_PASSWORD) {
    return new Response(JSON.stringify({ ok: false, error: "密码不正确" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const encoder = new TextEncoder();
  const expiry = Date.now() + 12*60*60*1000;
  const hashBytes = await crypto.subtle.digest("SHA-256", encoder.encode(env.SITE_PASSWORD + ":" + expiry));
  const hash = Array.from(new Uint8Array(hashBytes)).map(b => b.toString(16).padStart(2,"0")).join("");
  const resp = new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  resp.headers.set("set-cookie", "ouyu_session=" + encodeURIComponent(hash + ":" + expiry) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200");
  return resp;
}

export async function onRequest(context) {
  const { request, env } = context;
  const cookie = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(cookie.split(";").map(c => c.trim().split("=").map(decodeURIComponent)).filter(p => p.length === 2));
  const token = cookies.ouyu_session;
  let ok = false;
  if (token) {
    const [hash, expiry] = token.split(":");
    if (hash && expiry && Date.now() <= Number(expiry)) {
      const encoder = new TextEncoder();
      const expectedBytes = await crypto.subtle.digest("SHA-256", encoder.encode(env.SITE_PASSWORD + ":" + expiry));
      const expected = Array.from(new Uint8Array(expectedBytes)).map(b => b.toString(16).padStart(2,"0")).join("");
      ok = hash === expected;
    }
  }
  return new Response(JSON.stringify({ ok: true, authenticated: ok }), { headers: { "content-type": "application/json" } });
}

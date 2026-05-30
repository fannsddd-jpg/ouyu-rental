export async function onRequest() {
  const resp = new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  resp.headers.set("set-cookie", "ouyu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return resp;
}

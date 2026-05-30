export async function onRequest(context) {
  const db = context.env.DB;
  const results = {};

  // 测试 .run() 带参数
  const r1 = db.prepare("CREATE TABLE IF NOT EXISTS t_test (id TEXT, val TEXT)").run();
  results.createTable = { success: r1?.success, error: r1?.error };

  // 测试 .run() 直接传参
  const r2 = db.prepare("INSERT INTO t_test (id, val) VALUES (?1, ?2)").run("a", "hello");
  results.insertDirect = { success: r2?.success, error: r2?.error, meta: r2?.meta };

  // 测试 .bind().run()
  const r3 = db.prepare("INSERT INTO t_test (id, val) VALUES (?, ?)").bind("b", "world").run();
  results.insertBind = { success: r3?.success, error: r3?.error, meta: r3?.meta };

  // 测试 .all()
  const r4 = db.prepare("SELECT * FROM t_test").all();
  results.select = { results: r4?.results, success: r4?.success, error: r4?.error };

  // 测试 .first()
  const r5 = db.prepare("SELECT * FROM t_test WHERE id = ?1").first("a");
  results.first = r5;

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "content-type": "application/json" }
  });
}

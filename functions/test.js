export async function onRequest(context) {
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "No DB binding" }), {
      headers: { "content-type": "application/json" }
    });
  }

  try {
    // 尝试创建表
    db.prepare("CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, value TEXT)").run();

    // 写入数据
    db.prepare("INSERT OR REPLACE INTO test_table (id, value) VALUES (?, ?)").bind("1", "hello-d1").run();

    // 读取数据
    const result = db.prepare("SELECT * FROM test_table").all();

    return new Response(JSON.stringify({
      success: true,
      results: result.results || [],
      raw: result
    }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}

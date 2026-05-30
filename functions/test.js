export async function onRequest(context) {
  const db = context.env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "No DB binding" }), {
      headers: { "content-type": "application/json" }
    });
  }

  try {
    const createResult = db.prepare("CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, value TEXT)").run();
    const insertResult = db.prepare("INSERT OR REPLACE INTO test_table (id, value) VALUES (?, ?)").bind("1", "hello-d1").run();
    const selectResult = db.prepare("SELECT * FROM test_table").all();
    const tablesResult = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

    return new Response(JSON.stringify({
      create: { success: createResult?.success, changes: createResult?.meta?.changes },
      insert: { success: insertResult?.success, changes: insertResult?.meta?.changes },
      select: { results: selectResult?.results, success: selectResult?.success },
      tables: tablesResult?.results,
      hasDB: !!db,
    }, null, 2), {
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}

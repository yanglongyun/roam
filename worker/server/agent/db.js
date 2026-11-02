// D1 的最小封装：所有调用都是异步的（电脑端是同步的，迁上云必须 await）。
export async function all(env, sql, params = []) {
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results || [];
}

export async function one(env, sql, params = []) {
  const rows = await all(env, sql, params);
  return rows[0] ?? null;
}

// RETURNING 语句用 .first()：部分运行时对 RETURNING + all() 支持不一致。
export async function first(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).first();
}

export async function run(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params).run();
}

// 需要原子性的多语句：D1 的 batch 整体成功或整体失败（没有 BEGIN/COMMIT）。
export async function batch(env, statements) {
  if (!statements.length) return [];
  return env.DB.batch(statements);
}

export function statement(env, sql, params = []) {
  return env.DB.prepare(sql).bind(...params);
}

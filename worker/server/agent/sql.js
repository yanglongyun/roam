// sql 工具：模型对自己数据库的完整访问（读 + 写 + 改结构）。
// 仍然只放行单条语句 —— D1 的 prepare 本身也只接受一条，顺便挡住拼接注入。
export const MAX_ROWS = 200;
export const MAX_BYTES = 128 * 1024;

// 这些是读取语句，会套一层 LIMIT 限制返回量；其余按写入处理，原样执行。
const READ_WORDS = new Set(['select', 'with']);

// 切词：跳过字符串、被引用的标识符和注释，只留下裸 token，避免把字符串里的关键字当成语法。
function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < source.length) {
        if (source[i] === quote) {
          // '' / "" / `` 是转义的引号本身
          if (source[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      tokens.push({ kind: 'literal', index: i });
      continue;
    }
    if (c === '[') {
      while (i < source.length && source[i] !== ']') i += 1;
      i += 1;
      tokens.push({ kind: 'literal', index: i });
      continue;
    }
    if (c === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
      tokens.push({ kind: 'word', text: source.slice(start, i).toLowerCase(), index: i });
      continue;
    }
    if (c === ';') {
      i += 1;
      // index 记在分号之后，判尾分号时直接和语句长度比
      tokens.push({ kind: 'semicolon', index: i });
      continue;
    }
    i += 1;
  }
  return tokens;
}

// 校验并分类语句：单条、给出是读还是写。返回去掉结尾分号的语句。
export function checkQuery(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('sql 不能为空');
  }
  const tokens = tokenize(sql);
  const words = tokens.filter((t) => t.kind === 'word');
  if (!words.length) {
    throw new Error('sql 里没有可执行的语句');
  }
  const semicolons = tokens.filter((t) => t.kind === 'semicolon');
  const body = sql.trim();
  // 只允许末尾一个分号；后面还有内容说明拼了第二条语句
  if (
    semicolons.length > 1
    || (semicolons.length === 1 && body.slice(semicolons[0].index).trim() !== '')
  ) {
    throw new Error('一次只能执行一条语句');
  }
  const statement = body.endsWith(';') ? body.slice(0, -1).trim() : body;
  const first = words[0].text;
  // WITH ... 后面跟的可能仍是写入（如 WITH x AS (...) DELETE FROM ...），必须逐字判断。
  const read = READ_WORDS.has(first)
    && !words.some((w) => ['insert', 'update', 'delete', 'replace'].includes(w.text));
  return { statement, read, returning: /\breturning\b/i.test(statement) };
}

// 把结果按行序列化，超过字节上限就截断并说明。
function shape(rows) {
  const picked = rows.slice(0, MAX_ROWS);
  const out = [];
  let bytes = 0;
  for (const row of picked) {
    const line = JSON.stringify(row);
    if (bytes + line.length > MAX_BYTES) break;
    bytes += line.length;
    out.push(row);
  }
  const notes = [];
  if (rows.length > MAX_ROWS) notes.push(`结果超过 ${MAX_ROWS} 行，已截断`);
  if (out.length < picked.length) notes.push('结果超过 128 KiB，已截断');
  return { rows: out, notes };
}

// 执行一次查询或写入。db 是 D1 绑定。
export async function runSql(db, args) {
  const { sql, params = [] } = args || {};
  const { statement, read, returning } = checkQuery(sql);
  if (!Array.isArray(params) || params.some((p) => p !== null && !['string', 'number'].includes(typeof p))) {
    throw new Error('params 只能是字符串、数字或 null 组成的数组');
  }
  // 读取时外面套一层 LIMIT，避免 SELECT * FROM messages 把整库拉进上下文。
  const prepared = db.prepare(read ? `SELECT * FROM (${statement}) LIMIT ${MAX_ROWS + 1}` : statement);
  const bound = params.length ? prepared.bind(...params) : prepared;

  let result;
  if (read || returning) {
    result = await bound.all();
  } else {
    // 写入用 run，拿到 changes / last_row_id 给模型确认影响范围。
    result = await bound.run();
  }

  const meta = result.meta || {};
  const rows = read ? shape(result.results || []) : { rows: [], notes: [] };
  const notes = [...rows.notes];
  if (!read) {
    notes.push(`${meta.changes ?? 0} 行受影响`);
    if (meta.last_row_id) notes.push(`last_row_id=${meta.last_row_id}`);
  }
  return {
    columns: rows.rows.length ? Object.keys(rows.rows[0]) : [],
    row_count: rows.rows.length,
    rows: rows.rows,
    changes: meta.changes ?? 0,
    note: notes.join('；'),
  };
}

// 给模型看的表结构说明，跟着工具定义一起送过去。
export const SCHEMA_HINT = `
表与视图：
- sessions(id, title, pin, system_prompt, created_at, updated_at)  system_prompt 是会话级提示词覆盖，JSON 编码字符串，空则用设置里的
- messages(id, session_id, item, usage, created_at)  item 是模型 item 的 JSON；usage 是这次调用的 token 用量（含 model 字段），金额不存库、按单价现算
- compactions(id, session_id, message_id, summary, usage, created_at)
- devices(id, name, description, platform, arch, host, username, workdir, browser, last_seen, created_at)  已接入过的设备
- settings(key, value, updated_at)
- images(id, session_id, mime, size, created_at)
- v_sessions(id, title, pin, created_at, updated_at, message_count)
- v_messages(id, session_id, kind, role, tool_name, text, payload, call_id, created_at)
    kind: message(对话正文) / reasoning(思考) / function_call(工具调用) / function_call_output(工具结果)
    text: message 与 reasoning 的正文；payload: 工具名对应参数或结果（JSON 字符串）
- v_compactions(id, session_id, message_id, summary, usage, created_at)
- v_devices(id, name, description, platform, host, username, workdir, browser, last_seen)
- tasks(id, title, pinned, status, progress, device_id, workdir, budget, steps, cost, created_at, updated_at, finished_at)  任务的控制面，id 就是它那个会话的 id；title 空则回退到会话标题，pinned=1 是常驻置顶（和 sessions.pin 的会话置顶无关）
    status: queued / running / needs_human / done / failed / cancelled / interrupted
- v_tasks(id, title, pinned, goal, status, progress, device_id, workdir, steps, cost, created_at, updated_at, finished_at, message_count)  title 是简短标题，goal 是创建时的完整目标
- task_notifications(id, task_id, status, payload, created_at, message_id, delivered_at, attempts, next_attempt_at, last_error)  任务结果的持久化投递队列，助理处理成功后写 delivered_at
时间戳是毫秒，用 datetime(created_at / 1000, 'unixepoch', 'localtime') 转可读时间。
写入注意：delete / update 没有撤销，动手前先用 SELECT 确认影响范围；改 messages.item 会直接改变模型读到的上下文。
`.trim();

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const articleKey = (a) => `${a.id}:${a.contentHash}`;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const analysisKey = (a) => a ? digest([a.analysisStatus, a.analyzedAt, a.batchFile]) : null;
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}
function files(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[\w-]+\.json$/.test(f)).sort() : [];
}

export function validateCommand(c, filename) {
  if (!c || c.schemaVersion !== 1 || !ID.test(c.id) || filename !== `${c.id}.json`) throw Error('invalid_command_id');
  if (c.type !== 'analyze' || ![100, 500, 'all'].includes(c.limit)) throw Error('invalid_command_limit');
  if (typeof c.instruction !== 'string' || !c.instruction.trim() || c.instruction.length > 1000) throw Error('invalid_instruction');
  if (typeof c.query !== 'string' || c.query.length > 100) throw Error('invalid_query');
  if (!Number.isFinite(Date.parse(c.createdAt)) || Date.parse(c.createdAt) > Date.now() + 600000) throw Error('invalid_created_at');
  // Never interpret extra fields as filesystem paths, programs or model configuration.
  if (Object.keys(c).some((k) => !['schemaVersion', 'id', 'type', 'limit', 'instruction', 'query', 'createdAt'].includes(k))) throw Error('unknown_command_field');
  return c;
}

/** Reconcile only against analyses already accepted by pipeline validation. No model calls. */
export function reconcileCommands(root, raws, analyses, { admit = false, now = new Date().toISOString() } = {}) {
  const dir = path.join(root, 'data/ai-commands');
  const byId = new Map(raws.map((r) => [r.id, r]));
  const tasks = files(path.join(dir, 'tasks')).map((f) => read(path.join(dir, 'tasks', f)));
  const reserved = new Set();
  for (const task of tasks) {
    for (const item of task.items) {
      const raw = byId.get(item.id), a = analyses.get(item.id);
      if (!raw || raw.contentHash !== item.contentHash) item.status = 'stale';
      else if (['done', 'discarded'].includes(a?.analysisStatus) && a.contentHash === item.contentHash) item.status = a.analysisStatus;
      else if (a?.contentHash === item.contentHash && analysisKey(a) !== item.previousAnalysis) item.status = a.analysisStatus;
      else item.status = 'pending';
      if (item.status === 'pending') reserved.add(articleKey(item));
    }
  }

  const results = [];
  for (const filename of files(path.join(dir, 'pending'))) {
    const id = filename.slice(0, -5), resultFile = path.join(dir, 'results', filename);
    let command;
    try { command = validateCommand(read(path.join(dir, 'pending', filename)), filename); }
    catch (error) {
      const rejected = { id, status: 'rejected', reason: error.message, total: 0, completed: 0, failed: 0, pending: 0, blocked: 0, alreadyQueued: 0 };
      save(resultFile, rejected); results.push(rejected); continue;
    }
    let result = fs.existsSync(resultFile) ? read(resultFile) : null;
    // Commands are immutable. Editing an admitted request must not enqueue it twice.
    if (result?.commandHash && result.commandHash !== digest(command)) {
      result = { ...result, status: 'rejected', reason: 'command_changed_create_new_id' };
      save(resultFile, result); results.push(result); continue;
    }
    if (!result?.commandHash && admit) {
      const query = command.query.trim().toLocaleLowerCase();
      const candidates = raws.filter((r) => !r.discardReason && !['done', 'discarded'].includes(analyses.get(r.id)?.analysisStatus)
        && (!query || `${r.title} ${r.sourceName} ${r.content}`.toLocaleLowerCase().includes(query)))
        .sort((a, b) => Date.parse(b.publishedAt || b.crawledAt) - Date.parse(a.publishedAt || a.crawledAt) || a.id.localeCompare(b.id));
      const blocked = candidates.filter((r) => r.contentStatus !== 'ready' || (r.content?.length || 0) < 120).length;
      const ready = candidates.filter((r) => r.contentStatus === 'ready' && r.content?.length >= 120);
      const alreadyQueued = ready.filter((r) => reserved.has(articleKey(r))).length;
      const selected = ready.filter((r) => !reserved.has(articleKey(r))).slice(0, command.limit === 'all' ? undefined : command.limit);
      result = { id, commandHash: digest(command), instruction: command.instruction, query: command.query, limit: command.limit,
        createdAt: command.createdAt, admittedAt: now, total: selected.length, blocked, alreadyQueued,
        remaining: ready.length - alreadyQueued - selected.length, taskIds: [] };
      for (let i = 0; i < selected.length; i += 30) {
        const taskId = `${id}-${String(i / 30 + 1).padStart(4, '0')}`;
        const task = { schemaVersion: 1, id: taskId, commandId: id, createdAt: now, instruction: command.instruction,
          items: selected.slice(i, i + 30).map((r) => ({ id: r.id, contentHash: r.contentHash, rawPath: `data/raw/${r.id}.json`,
            previousAnalysis: analysisKey(analyses.get(r.id)), status: 'pending' })) };
        tasks.push(task); result.taskIds.push(taskId);
        for (const item of task.items) reserved.add(articleKey(item));
      }
    }
    if (!result?.commandHash) {
      results.push({ id, instruction: command.instruction, limit: command.limit, createdAt: command.createdAt, status: 'pending', total: 0, completed: 0, failed: 0, pending: 0, blocked: 0, alreadyQueued: 0 });
      continue;
    }
    const items = tasks.filter((t) => t.commandId === id).flatMap((t) => t.items);
    result.completed = items.filter((i) => ['done', 'discarded'].includes(i.status)).length;
    result.failed = items.filter((i) => ['failed', 'stale'].includes(i.status)).length;
    result.pending = items.filter((i) => i.status === 'pending').length;
    result.status = result.pending ? 'awaiting_analysis' : result.failed ? 'partial' : result.total ? 'completed' : 'no_work';
    // blocked/remaining describe the admission snapshot, never pretend the entire backlog was cleared.
    save(resultFile, result); results.push(result);
  }
  for (const task of tasks) {
    task.status = task.items.some((i) => i.status === 'pending') ? 'pending' : task.items.some((i) => ['failed', 'stale'].includes(i.status)) ? 'partial' : 'completed';
    save(path.join(dir, 'tasks', `${task.id}.json`), task);
  }
  const queue = { schemaVersion: 1, items: tasks.filter((t) => t.status === 'pending').map((t) => ({
    id: t.id, commandId: t.commandId, taskPath: `data/ai-commands/tasks/${t.id}.json`, createdAt: t.createdAt,
    pending: t.items.filter((i) => i.status === 'pending').length,
  })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) };
  if (fs.existsSync(dir)) save(path.join(dir, 'queue.json'), queue);
  save(path.join(root, 'client/public/data/ai-commands.json'), { schemaVersion: 1,
    items: results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')), pendingTasks: queue.items.length });
  return { reserved, results, tasks: queue.items };
}

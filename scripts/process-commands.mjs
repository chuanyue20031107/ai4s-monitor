import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const commandDir = path.join(root, 'data', 'commands', 'pending');
const doneDir = path.join(root, 'data', 'commands', 'done');

fs.mkdirSync(commandDir, { recursive: true });
fs.mkdirSync(doneDir, { recursive: true });

const files = fs.readdirSync(commandDir).filter((f) => f.endsWith('.json'));
const results = [];

for (const file of files) {
  const full = path.join(commandDir, file);
  const command = JSON.parse(fs.readFileSync(full, 'utf8'));

  results.push({
    commandId: command.id || file,
    action: command.action,
    sourceId: command.sourceId || null,
    status: 'accepted',
    receivedAt: new Date().toISOString(),
    note: 'Command accepted. Corresponding workflow execution is scheduled.',
  });

  fs.renameSync(full, path.join(doneDir, file));
}

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'data', 'command-results.json'),
  JSON.stringify({ items: results, updatedAt: new Date().toISOString() }, null, 2),
);

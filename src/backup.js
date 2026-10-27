// Cópias de segurança automáticas com a API de backup do SQLite (cópia consistente,
// mesmo com a app em uso). Guarda as últimas N; o diretório deve estar fora do contentor.
import fs from 'node:fs';
import path from 'node:path';
import { nowLocal } from './time.js';

const PATTERN = /^ortoptica-\d{4}-\d{2}-\d{2}_\d{4}\.sqlite$/;

export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => PATTERN.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
}

export function isBackupName(name) {
  return PATTERN.test(name);
}

export async function runBackup(db, dir, keep) {
  fs.mkdirSync(dir, { recursive: true });
  const local = nowLocal(); // 'YYYY-MM-DDTHH:MM' em hora de Lisboa
  const name = `ortoptica-${local.slice(0, 10)}_${local.slice(11, 13)}${local.slice(14, 16)}.sqlite`;
  const tmp = path.join(dir, `.${name}.tmp`);
  await db.backup(tmp);
  fs.renameSync(tmp, path.join(dir, name));
  for (const old of listBackups(dir).slice(keep)) fs.rmSync(path.join(dir, old.name), { force: true });
  return name;
}

export function scheduleBackups(db, { dir, keep, everyHours, log }) {
  const due = () => {
    const last = listBackups(dir)[0];
    return !last || Date.now() - last.mtime.getTime() > everyHours * 3600 * 1000;
  };
  const tick = async () => {
    try {
      if (due()) log.info({ backup: await runBackup(db, dir, keep) }, 'cópia de segurança criada');
    } catch (err) {
      log.error({ err }, 'falha na cópia de segurança');
    }
  };
  tick();
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  return timer;
}

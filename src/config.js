// Toda a configuração vem de variáveis de ambiente, com valores por omissão seguros.
// Nada de segredos no código: as palavras-passe são geradas pela CLI e o token ICS é aleatório.
import path from 'node:path';

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Variável ${name} inválida: ${v}`);
  return n;
}

const dataDir = process.env.DATA_DIR || path.resolve('data');

export const config = {
  port: int('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, 'ortoptica.sqlite'),
  backupDir: process.env.BACKUP_DIR || path.resolve('backups'),
  backupKeep: int('BACKUP_KEEP', 30),
  backupEveryHours: int('BACKUP_EVERY_HOURS', 24),
  sessionIdleHours: int('SESSION_IDLE_HOURS', 10),
  // Só confiar nos cabeçalhos X-Forwarded-* quando há um proxy HTTPS à frente (tailscale serve, NPM).
  trustProxy: process.env.TRUST_PROXY === 'true',
  timeZone: 'Europe/Lisbon',
  logLevel: process.env.LOG_LEVEL || 'info',
};

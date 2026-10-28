// Linha de comandos para administração sem interface:
//   node src/cli.js criar-utilizador <utilizador> "<Nome>" [ortoptista]
//   node src/cli.js nova-password <utilizador>
//   node src/cli.js backup
//   node src/cli.js utilizadores
//   node src/cli.js limpar-atividade [--confirmar]
// As palavras-passe são geradas e mostradas uma vez (não ficam no histórico da shell).
import { config } from './config.js';
import { audit, openDb } from './db.js';
import { destroyUserSessions, generatePassword, hashPassword } from './auth.js';
import { runBackup } from './backup.js';

const [cmd, ...args] = process.argv.slice(2);
const db = openDb(config.dbFile);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

try {
  if (cmd === 'criar-utilizador') {
    // Só há contas de ortoptista: o secretariado usa o link de reservas.
    const [username, name, role = 'ortoptista'] = args;
    if (!username || !name || role !== 'ortoptista') {
      fail('Uso: criar-utilizador <utilizador> "<Nome>" [ortoptista]');
    }
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) fail('Utilizador inválido (letras, números, . _ -).');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail('Esse utilizador já existe.');
    const pw = generatePassword();
    const info = db.prepare('INSERT INTO users (username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)')
      .run(username, name, role, hashPassword(pw));
    audit(db, null, 'criar_cli', 'utilizador', Number(info.lastInsertRowid), { role });
    console.log(`Utilizador «${username}» criado.\nPalavra-passe temporária: ${pw}\nVai ser pedida uma nova no primeiro acesso.`);
  } else if (cmd === 'nova-password') {
    const [username] = args;
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
    if (!u) fail('Utilizador não encontrado.');
    const pw = generatePassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, active = 1 WHERE id = ?').run(hashPassword(pw), u.id);
    destroyUserSessions(db, u.id);
    audit(db, null, 'reset_password_cli', 'utilizador', u.id);
    console.log(`Nova palavra-passe temporária para «${u.username}»: ${pw}`);
  } else if (cmd === 'backup') {
    const name = await runBackup(db, config.backupDir, config.backupKeep);
    console.log(`Cópia criada: ${config.backupDir}/${name}`);
  } else if (cmd === 'utilizadores') {
    for (const u of db.prepare('SELECT username, display_name, role, active FROM users ORDER BY username').all()) {
      console.log(`${u.username}\t${u.display_name}\t${u.role}\t${u.active ? 'ativo' : 'inativo'}`);
    }
  } else if (cmd === 'limpar-atividade') {
    // Apaga a atividade (pedidos, exames, reservas, relatórios, bloqueios e o histórico deles), por exemplo
    // depois de testes. Mantém a configuração: utilizadores, horário, atos/MCDTs e fichas, link de reservas,
    // lista de quem reserva, temas, cabeçalho dos relatórios e notificações.
    const tables = [
      ['report_history', 'versões de relatórios'], ['reports', 'relatórios'], ['exams', 'exames e reservas'],
      ['requests', 'pedidos'], ['blocks', 'bloqueios'],
    ];
    const logWhere = "entity IN ('exame', 'pedido', 'bloqueio', 'relatorio')";
    const counts = tables.map(([t, label]) => [t, label, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]);
    const logN = db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE ${logWhere}`).get().n;
    for (const [, label, n] of counts) console.log(`${String(n).padStart(6)}  ${label}`);
    console.log(`${String(logN).padStart(6)}  entradas de histórico desses registos`);
    if (!args.includes('--confirmar')) {
      console.log('\nNada foi apagado. Para apagar, repita com --confirmar (é feita uma cópia de segurança antes).');
    } else {
      const name = await runBackup(db, config.backupDir, config.backupKeep);
      console.log(`\nCópia de segurança: ${config.backupDir}/${name}`);
      db.transaction(() => {
        for (const [t] of counts) db.prepare(`DELETE FROM ${t}`).run();
        db.prepare(`DELETE FROM audit_log WHERE ${logWhere}`).run();
      })();
      audit(db, null, 'limpar_atividade_cli', 'definicoes', null, Object.fromEntries(counts.map(([t, , n]) => [t, n])));
      db.exec('VACUUM');
      console.log('Atividade apagada. A configuração ficou como estava.');
    }
  } else {
    fail('Comandos: criar-utilizador, nova-password, backup, utilizadores, limpar-atividade');
  }
} finally {
  db.close();
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { makeApp, login, post, get } from './helpers.js';
import { getSetting } from '../src/db.js';
import { todayLocal } from '../src/time.js';

const getBin = (app, url, cookie) => app.inject({ method: 'GET', url, headers: { host: 'localhost:80', ...(cookie ? { cookie } : {}) } });

// Texto do PDF (com o pdftotext, se existir nesta máquina; senão estes passos são saltados).
function pdfText(buf) {
  try {
    const f = path.join(os.tmpdir(), `req-${process.pid}-${Date.now()}.pdf`);
    fs.writeFileSync(f, buf);
    const out = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
    fs.unlinkSync(f);
    return out;
  } catch { return null; }
}

test('requisição: PDF editável a partir dos atos; link no secretariado; definições', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const base = `/r/${getSetting(db, 'booking_token')}`;
  const page = await get(app, base);
  assert.match(page.body, new RegExp(`href="${base}/requisicao.pdf" download`));
  const r = await getBin(app, `${base}/requisicao.pdf`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'application/pdf');
  assert.match(r.headers['content-disposition'], /attachment/);
  const pdf = await PDFDocument.load(r.rawPayload);
  assert.equal(pdf.getPageCount(), 2);
  const names = pdf.getForm().getFields().map((f) => f.getName());
  for (const n of ['doente', 'doente_telefone', 'clinica', 'medico', 'req_email', 'exame_erg', 'exame_oct', 'olho_od', 'exame_outro']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('exame_refracao_fmri'), 'avaliações de investigação nunca aparecem');
  assert.ok(!names.includes('exame_ensaio'), 'atos sem grupo não aparecem');
  assert.ok(names.includes('envio_email'), 'sem e-mail definido, fica um campo');
  // Link com token errado não dá o PDF
  assert.equal((await getBin(app, '/r/errado/requisicao.pdf')).statusCode, 404);

  // Definições: e-mail fixo, tirar um ato, nota de preparação, página 2 em Markdown
  const ergId = db.prepare("SELECT id FROM exam_types WHERE code = 'erg'").pluck().get();
  const eogId = db.prepare("SELECT id FROM exam_types WHERE code = 'eog'").pluck().get();
  assert.match((await get(app, '/admin/requisicao', hugo)).body, /Exames no impresso/);
  const save = await post(app, '/admin/requisicao', hugo, {
    req_email: 'marcacoes@icnas.example', req_clinical_label: 'Suspeita diagnóstica',
    [`group.${ergId}`]: 'eletro', [`prep.${ergId}`]: 'inclui dilatação', [`group.${eogId}`]: '', [`prep.${eogId}`]: '',
    req_patient_info: '## Antes do exame\nTraga **os óculos**.\n- ponto um',
  });
  assert.match(save.headers.location, /msg=guardado/);
  assert.equal(getSetting(db, 'req_updated_at'), todayLocal());
  const r2 = await getBin(app, '/admin/requisicao.pdf', hugo);
  const names2 = (await PDFDocument.load(r2.rawPayload)).getForm().getFields().map((f) => f.getName());
  assert.ok(!names2.includes('exame_eog'), 'ato tirado do impresso');
  assert.ok(!names2.includes('envio_email'), 'com e-mail definido, sai como texto');
  const txt = pdfText(r2.rawPayload);
  if (txt) {
    assert.match(txt, /marcacoes@icnas\.example/);
    assert.match(txt, /Antes do exame/);
    assert.match(txt, /Traga os óculos\./);
    assert.match(txt, /inclui dilatação/);
    assert.match(txt, /Versão de \d+ de \w+ de \d{4}/);
    assert.ok(!/\bEOG\b/.test(txt.split('Duração')[1] || ''), 'EOG fora da tabela de durações');
  }
  // E-mail inválido recusado
  assert.match((await post(app, '/admin/requisicao', hugo, { req_email: 'não é email' })).headers.location, /err=/);
  // Só o ortoptista vê a pré-visualização da administração
  assert.equal((await getBin(app, '/admin/requisicao.pdf')).statusCode, 302);
});

test('requisição: logótipo PNG dos relatórios entra no cabeçalho; caracteres estranhos não partem o PDF', async () => {
  const { app, db } = await makeApp();
  const hugo = await login(app, 'hugo');
  const png = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c80000000049454e44ae426082', 'hex').toString('base64')}`;
  await post(app, '/admin/relatorio/logo', hugo, { logo: png });
  await post(app, '/admin/requisicao', hugo, { req_email: '', req_clinical_label: 'Clínica ✓ ≥ 😀', req_patient_info: '# Título 😀\nTexto com → seta e ✓.' });
  const r = await getBin(app, '/admin/requisicao.pdf', hugo);
  assert.equal(r.statusCode, 200);
  const pdf = await PDFDocument.load(r.rawPayload);
  assert.equal(pdf.getPageCount(), 2);
  assert.ok(r.rawPayload.includes('/Image'), 'logótipo embebido');
});

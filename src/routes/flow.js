// Quadro «Fluxo»: a vista geral do percurso de todos os exames em curso, por circuito.
// A «Hoje» continua a ser o dia; o quadro mostra onde o trabalho está parado.
import { html, raw } from '../html.js';
import { examsWhere } from '../repo.js';
import { buildBoard, COLUMNS } from '../domain/flow.js';
import { addDays, fmtDate, todayLocal } from '../time.js';
import { flash, pageHead, patientLabel, postButton } from '../ui.js';
import { send } from './util.js';

const BACK = '/fluxo';

function staleText(col, d) {
  if (col === 'fechar') return d === 1 ? 'desde ontem' : `há ${d} dias`;
  return `parado há ${d} dias`;
}

function card(c, lane) {
  const { e, col, stale, moves } = c;
  const when = e.starts_at ? `${fmtDate(e.starts_at).slice(0, 5)} ${e.starts_at.slice(11)}` : 'sem hora';
  const actions = Object.entries(moves).map(([to, mv]) => html`<span class="fl-move" data-move="${to}" data-move-label="${mv.label}">${mv.kind === 'post'
    ? postButton(mv.action, mv.label, { kind: 'mini', back: BACK })
    : html`<a class="btn mini" href="${mv.href}">${mv.label}</a>`}</span>`);
  const note = e.change_kind === 'mover' ? 'pede outra hora' : e.change_kind === 'cancelar' ? 'pede cancelamento'
    : e.status === 'pendente' ? (e.requisition ? '' : 'sem requisição') : e.report_status === 'rascunho' ? 'rascunho' : '';
  // O registo no Siima não depende do relatório: assinala-se também aqui o que ainda falta.
  const siima = col === 'relatorio' && lane !== 'investigacao' && !e.siima_registered_at
    ? html`<span class="fl-also">falta executar no Siima</span>` : '';
  return html`<li class="fl-card${stale ? ' stale' : ''}" data-card data-lane="${lane}"${Object.keys(moves).length ? raw(' draggable="true"') : ''}>
    <div class="fl-top"><span class="when">${when}</span>${stale ? html`<span class="fl-stale">${staleText(col, stale)}</span>` : ''}</div>
    <a class="fl-title" href="/exames/${e.id}">${e.type_name}</a>
    <div class="fl-meta">${patientLabel(e)}${e.source === 'secretariado' && e.booked_by_name ? html`<span class="by">${e.booked_by_name}</span>` : ''}${e.source === 'investigacao' && e.project ? html`<span class="by">${e.project}</span>` : ''}${note ? html`<span class="owed-txt">${note}</span>` : ''}${siima}</div>
    ${actions.length ? html`<div class="fl-acts">${actions}</div>` : ''}
  </li>`;
}

export default async function flowRoutes(app, { db }) {
  app.get('/fluxo', async (req, reply) => {
    const today = todayLocal();
    const from = `${addDays(today, -7)}T00:00`;
    // Em curso, mais o que foi concluído nos últimos 7 dias.
    const exams = examsWhere(db, `e.status IN ('pendente','por_agendar','agendado') OR e.change_kind IS NOT NULL
      OR (e.status = 'realizado' AND (rp.status IS NOT 'validado' OR (r.source <> 'investigacao' AND e.siima_registered_at IS NULL) OR e.starts_at >= ?))`,
    [from], 'e.starts_at, e.id', 1000);
    const lanes = buildBoard(exams, today);
    const colLabel = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label]));
    const total = lanes.reduce((a, l) => a + l.total, 0);
    const stale = lanes.reduce((a, l) => a + Object.values(l.cells).flat().filter((c) => c.stale).length, 0);
    const shown = lanes.filter((l) => l.total || l.key !== 'investigacao');

    return send(reply, req, {
      title: 'Fluxo',
      active: 'fluxo',
      wide: true,
      autorefresh: true,
      body: html`${pageHead('Fluxo', {
          sub: html`<span>${total} em curso${stale ? html` · <span class="late-txt">${stale} ${stale === 1 ? 'parado' : 'parados'}</span>` : ''}</span>`,
          info: html`<p>Cada exame está na coluna do passo em que vai. As colunas vêm do estado do exame: um cartão só avança quando o passo acontece.</p><p><b>Arrastar</b> um cartão para a coluna seguinte faz esse passo (pede confirmação); os botões no cartão fazem o mesmo. Passos que precisam de mais dados (hora, n.º de requisição, relatório) abrem a página respetiva.</p><p>A vermelho: parados há demasiado tempo (por confirmar ou por marcar há mais de 2 dias, relatório há mais de 5, por executar no Siima há mais de 2). «Concluído» mostra os últimos 7 dias.</p>`,
        })}
        ${flash(req.query, req)}
        <div class="flow" data-flow>
          <div class="fl-head" aria-hidden="true"><span></span>${COLUMNS.map((c) => html`<span>${c.label}</span>`)}</div>
          ${shown.map((l) => html`<section class="fl-lane" aria-label="${l.label}">
            <h2 class="fl-lane-h">${l.label}<span class="count">${l.total}</span></h2>
            ${COLUMNS.map((c) => {
              if (!l.cols.includes(c.key)) return html`<div class="fl-cell off" aria-hidden="true"></div>`;
              const cards = l.cells[c.key];
              const more = l.hidden[c.key];
              return html`<div class="fl-cell${cards.length ? '' : ' empty'}" data-col="${c.key}" data-lane="${l.key}">
                <h3 class="fl-col-h">${colLabel[c.key]} <span class="count">${cards.length + (more || 0)}</span></h3>
                ${cards.length ? html`<ul class="fl-cards">${cards.map((x) => card(x, l.key))}</ul>` : html`<p class="fl-none">—</p>`}
                ${more ? html`<p class="fl-more"><a href="/agenda">+ ${more} mais tarde</a></p>` : ''}
              </div>`;
            })}
          </section>`)}
        </div>
        <p class="muted small">Cancelados, recusados e faltas não entram no quadro. A faixa «Investigação» aparece quando há avaliações em curso.</p>`,
    });
  });
}

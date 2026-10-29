// «Fluxo»: vista de controlo do percurso de todos os exames em curso, por circuito.
// Não se arrasta nada: as colunas vêm do estado de cada exame. Cada coluna diz o que falta e de
// quem é a vez, quantos exames lá estão e há quanto tempo está parado o mais antigo; cada cartão
// tem um só botão, o passo seguinte. A «Hoje» continua a ser o dia; aqui vê-se onde o trabalho encalha.
import { html } from '../html.js';
import { examsWhere } from '../repo.js';
import { buildBoard, COLUMN_INFO, COLUMNS, LANES, STALE_DAYS } from '../domain/flow.js';
import { addDays, fmtDate, todayLocal } from '../time.js';
import { flash, pageHead, patientLabel, postButton } from '../ui.js';
import { send } from './util.js';

const BACK = '/fluxo';

function staleText(col, d) {
  if (col === 'fechar') return d === 1 ? 'desde ontem' : `há ${d} dias`;
  return `parado há ${d} dias`;
}

function nextStep(moves) {
  const [mv] = Object.values(moves);
  if (!mv) return '';
  return mv.kind === 'post' ? postButton(mv.action, mv.label, { kind: 'mini', back: BACK }) : html`<a class="btn mini" href="${mv.href}">${mv.label}</a>`;
}

function card(c, lane) {
  const { e, col, stale, moves } = c;
  const when = e.starts_at ? `${fmtDate(e.starts_at).slice(0, 5)} ${e.starts_at.slice(11)}` : 'sem hora';
  const note = e.change_kind === 'mover' ? 'pede outra hora' : e.change_kind === 'cancelar' ? 'pede cancelamento'
    : e.status === 'pendente' ? (e.requisition ? 'reserva nova' : 'reserva nova, sem requisição') : e.status === 'por_agendar' ? 'sem hora' : e.report_status === 'rascunho' ? 'relatório em rascunho' : '';
  // O registo no Siima não depende do relatório: assinala-se também aqui o que ainda falta.
  const siima = col === 'relatorio' && lane !== 'investigacao' && !e.siima_registered_at
    ? html`<span class="fl-also">falta também executar no Siima</span>` : '';
  const step = nextStep(moves);
  return html`<li class="fl-card${stale ? ' stale' : ''}">
    <div class="fl-top"><span class="when">${when}</span>${stale ? html`<span class="fl-stale">${staleText(col, stale)}</span>` : ''}</div>
    <a class="fl-title" href="/exames/${e.id}">${e.type_name}</a>
    <div class="fl-meta">${patientLabel(e)}${e.source === 'secretariado' && e.booked_by_name ? html`<span class="by">${e.booked_by_name}</span>` : ''}${e.source === 'investigacao' && e.project ? html`<span class="by">${e.project}</span>` : ''}${note ? html`<span class="owed-txt">${note}</span>` : ''}${siima}</div>
    ${String(step).trim() ? html`<div class="fl-acts">${step}</div>` : ''}
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
    const shown = lanes.filter((l) => l.total || l.key !== 'investigacao');
    // Por coluna, somando as faixas: quantos e o mais parado.
    const colStats = Object.fromEntries(COLUMNS.map((c) => {
      const cards = shown.flatMap((l) => l.cells[c.key] || []);
      const n = cards.length + shown.reduce((a, l) => a + (l.hidden[c.key] || 0), 0);
      return [c.key, { n, stale: cards.filter((x) => x.stale).length, oldest: Math.max(0, ...cards.map((x) => x.stale)) }];
    }));
    const total = Object.entries(colStats).filter(([k]) => k !== 'feito').reduce((a, [, s]) => a + s.n, 0);
    const stale = Object.values(colStats).reduce((a, s) => a + s.stale, 0);
    const colHead = (c, { mobile = false } = {}) => {
      const st = colStats[c.key];
      const info = COLUMN_INFO[c.key];
      return html`<div class="fl-ch${st.stale ? ' has-stale' : ''}">
        <span class="fl-ch-t"><span class="fl-ch-name">${c.label}</span>${mobile ? '' : html`<span class="count">${st.n}</span>`}</span>
        ${!mobile && st.stale ? html`<span class="fl-ch-late">${st.stale} ${st.stale === 1 ? 'parado' : 'parados'} · o mais antigo ${staleText(c.key, st.oldest)}</span>` : ''}
      </div>`;
    };

    return send(reply, req, {
      title: 'Fluxo',
      active: 'fluxo',
      wide: true,
      autorefresh: true,
      body: html`${pageHead('Fluxo', {
          sub: html`<span>${total} em curso${stale ? html` · <span class="late-txt">${stale} ${stale === 1 ? 'parado' : 'parados'}</span>` : ''}</span>`,
          info: html`<p>Onde está cada exame no seu percurso. Um cartão passa à coluna seguinte quando o passo acontece, aqui ou noutra página. Cada cartão tem o botão do passo seguinte; o nome do exame abre a página dele.</p>
            <dl class="fl-help">${COLUMNS.map((c) => html`<dt>${c.label}</dt><dd>${COLUMN_INFO[c.key].what}${COLUMN_INFO[c.key].who ? ` Vez de: ${COLUMN_INFO[c.key].who}.` : ''}</dd>`)}</dl>
            <p><b>Circuitos:</b> ${LANES.map((l, i) => html`${i ? ' ' : ''}<b>${l.label}</b> — ${l.note}`)}</p>
            <p>A vermelho: parados há demasiado tempo (por confirmar ou por marcar há mais de ${STALE_DAYS.entrada} dias, relatório há mais de ${STALE_DAYS.relatorio}, por executar no Siima há mais de ${STALE_DAYS.siima}, ou o dia já passou).</p>`,
        })}
        ${flash(req.query, req)}
        <div class="flow">
          <div class="fl-head"><span class="fl-corner"></span>${COLUMNS.map((c) => colHead(c))}</div>
          ${shown.map((l) => html`<section class="fl-lane" aria-labelledby="fl-l-${l.key}">
            <div class="fl-lane-h"><h2 id="fl-l-${l.key}">${l.label}<span class="count">${l.total}</span></h2></div>
            ${COLUMNS.map((c) => {
              if (!l.cols.includes(c.key)) return html`<div class="fl-cell off" aria-hidden="true"></div>`;
              const cards = l.cells[c.key];
              const more = l.hidden[c.key];
              return html`<div class="fl-cell${cards.length ? '' : ' empty'}">
                <h3 class="fl-col-h">${c.label} <span class="count">${cards.length + (more || 0)}</span></h3>
                <div class="fl-col-info">${colHead(c, { mobile: true })}</div>
                ${cards.length ? html`<ul class="fl-cards">${cards.map((x) => card(x, l.key))}</ul>` : html`<p class="fl-none">—</p>`}
                ${more ? html`<p class="fl-more"><a href="/agenda?vista=mes">+ ${more} mais tarde</a></p>` : ''}
              </div>`;
            })}
          </section>`)}
        </div>
        <p class="muted small">Cancelados, recusados e faltas não entram aqui. A faixa «Investigação» aparece quando há avaliações em curso.</p>`,
    });
  });
}

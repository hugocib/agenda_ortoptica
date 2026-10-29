// Quadro «Fluxo»: cada exame numa coluna, segundo o passo em que está do seu percurso.
// As colunas vêm do estado (nunca se criam nem se escolhem à mão). Um cartão só muda de coluna
// quando o passo acontece: arrastar faz a ação verdadeira, e só para a coluna seguinte permitida.
// Funções puras, sem base de dados.
import { addDays } from '../time.js';

export const COLUMNS = [
  { key: 'entrada', label: 'Por confirmar / agendar' },
  { key: 'marcar', label: 'Por marcar no Siima' },
  { key: 'agendado', label: 'Agendado' },
  { key: 'fechar', label: 'Por realizar' },
  { key: 'relatorio', label: 'Relatório' },
  { key: 'siima', label: 'Executar no Siima' },
  { key: 'feito', label: 'Concluído' },
];

// Faixas (circuitos) e as colunas por onde cada uma passa.
export const LANES = [
  { key: 'secretariado', label: 'Secretariado', cols: ['entrada', 'agendado', 'fechar', 'relatorio', 'siima', 'feito'] },
  { key: 'direto', label: 'Fora do circuito', cols: ['entrada', 'marcar', 'agendado', 'fechar', 'relatorio', 'siima', 'feito'] },
  { key: 'investigacao', label: 'Investigação', cols: ['agendado', 'fechar', 'relatorio', 'feito'] },
];

// Dias a partir dos quais um cartão parado fica assinalado (por coluna).
export const STALE_DAYS = { entrada: 2, marcar: 2, fechar: 0, relatorio: 5, siima: 2 };

export const laneOf = (e) => (e.source === 'secretariado' || e.source === 'investigacao' ? e.source : 'direto');

/** Coluna do exame, ou null se não entra no quadro (cancelado, recusado, faltou). */
export function columnOf(e, today) {
  const s = e.status;
  const lane = laneOf(e);
  if (e.change_kind || s === 'pendente' || s === 'por_agendar') return lane === 'investigacao' ? 'agendado' : 'entrada';
  if (s === 'agendado') {
    if (lane === 'direto' && !e.siima_booked_at) return 'marcar';
    return e.starts_at.slice(0, 10) <= today ? 'fechar' : 'agendado';
  }
  if (s === 'realizado') {
    if (e.report_status !== 'validado') return 'relatorio';
    if (lane !== 'investigacao' && !e.siima_registered_at) return 'siima';
    return 'feito';
  }
  return null;
}

/** Desde quando o exame está nesta coluna (data local 'YYYY-MM-DD'), para assinalar atrasos. */
export function sinceOf(e, col) {
  if (col === 'entrada') return (e.change_requested_at || e.created_at || '').slice(0, 10);
  if (col === 'marcar') return (e.confirmed_at || e.created_at || '').slice(0, 10);
  if (col === 'fechar' || col === 'relatorio' || col === 'siima') return e.starts_at.slice(0, 10);
  return null;
}

export function staleDays(e, col, today) {
  const since = sinceOf(e, col);
  if (!since || STALE_DAYS[col] === undefined) return 0;
  const d = Math.round((Date.parse(`${today}T00:00Z`) - Date.parse(`${since}T00:00Z`)) / 86400000);
  return d > STALE_DAYS[col] ? d : 0;
}

/**
 * Para onde o cartão pode ser arrastado e o que isso faz.
 * kind: 'post' (ação direta, com confirmação) ou 'go' (abre a página onde o passo se completa).
 */
export function movesOf(e, col, today) {
  const id = e.id;
  const lane = laneOf(e);
  const future = Boolean(e.starts_at && e.starts_at.slice(0, 10) > today);
  const m = {};
  if (col === 'entrada') {
    const next = future ? 'agendado' : 'fechar';
    if (e.change_kind) m[next] = { kind: 'go', href: `/exames/${id}#confirmar`, label: 'Decidir o pedido do secretariado' };
    else if (e.status === 'pendente' && e.requisition) m[next] = { kind: 'post', action: `/exames/${id}/confirmar`, label: 'Confirmar a reserva' };
    else if (e.status === 'pendente') m[next] = { kind: 'go', href: `/exames/${id}#confirmar`, label: 'Confirmar (falta o n.º de requisição)' };
    else m[lane === 'direto' ? 'marcar' : 'agendado'] = { kind: 'go', href: `/exames/${id}/agendar`, label: 'Escolher a hora' };
  }
  if (col === 'marcar') m[future ? 'agendado' : 'fechar'] = { kind: 'post', action: `/exames/${id}/siima-marcado`, label: 'Marcado no Siima' };
  if ((col === 'agendado' || col === 'fechar') && e.status === 'agendado' && !future) {
    m.relatorio = { kind: 'post', action: `/exames/${id}/realizado`, label: lane === 'investigacao' ? 'Avaliação realizada' : 'Exame realizado' };
  }
  if (col === 'relatorio') {
    m[lane === 'investigacao' || e.siima_registered_at ? 'feito' : 'siima'] = { kind: 'go', href: `/exames/${id}/relatorio`, label: lane === 'investigacao' ? 'Validar a ficha' : 'Validar o relatório' };
  }
  if (col === 'siima') m.feito = { kind: 'post', action: `/exames/${id}/siima-registado`, label: 'Executado no Siima' };
  return m;
}

/**
 * Monta o quadro: faixas × colunas, com os cartões ordenados por data.
 * «Concluído» só mostra os últimos 7 dias; «Agendado» mostra no máximo `maxFuture` por faixa.
 */
export function buildBoard(exams, today, { doneDays = 7, maxFuture = 12 } = {}) {
  const doneFrom = addDays(today, -doneDays);
  const lanes = LANES.map((l) => ({ ...l, cells: Object.fromEntries(l.cols.map((c) => [c, []])), hidden: {} }));
  for (const e of exams) {
    const col = columnOf(e, today);
    if (!col) continue;
    if (col === 'feito' && e.starts_at.slice(0, 10) < doneFrom) continue;
    const lane = lanes.find((l) => l.key === laneOf(e));
    if (!lane.cells[col]) continue;
    lane.cells[col].push({ e, col, stale: staleDays(e, col, today), moves: movesOf(e, col, today) });
  }
  for (const l of lanes) {
    for (const [col, cards] of Object.entries(l.cells)) {
      cards.sort((a, b) => (col === 'feito' ? -1 : 1) * String(a.e.starts_at || a.e.created_at).localeCompare(String(b.e.starts_at || b.e.created_at)));
      if (col === 'agendado' && cards.length > maxFuture) l.hidden[col] = cards.splice(maxFuture).length;
    }
    l.total = Object.values(l.cells).reduce((a, c) => a + c.length, 0) + Object.values(l.hidden).reduce((a, n) => a + n, 0);
  }
  return lanes;
}

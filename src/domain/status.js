// Máquina de estados dos exames. Todas as mudanças passam por aqui, para que
// não haja transições impossíveis (p. ex. executar no Siima um exame que não foi feito).
//
// Dois circuitos:
//  - «secretariado»: reserva feita pelo link (sem dados do doente) → o ortoptista confirma →
//    realizado → relatório → executado no Siima. A marcação no Siima é feita pelo secretariado.
//  - «direto» (fora do circuito): o ortoptista cria o pedido e faz o percurso todo no Siima:
//    agendado → marcado no Siima → realizado → relatório → executado no Siima.

export const STATUS_LABEL = {
  pendente: 'Por confirmar',
  por_agendar: 'Por agendar',
  agendado: 'Agendado',
  realizado: 'Realizado',
  faltou: 'Faltou',
  cancelado: 'Cancelado',
  recusado: 'Recusado',
};

export const ORIGIN_LABEL = {
  externo: 'Externo',
  projeto: 'Projeto interno',
  ensaio: 'Ensaio clínico',
};

export const SOURCE_LABEL = {
  secretariado: 'Reserva do secretariado',
  direto: 'Fora do circuito',
};

// Estados que ocupam a agenda (uma reserva por confirmar já ocupa a vaga).
export const BUSY_STATUSES = ['pendente', 'agendado', 'realizado'];
export const SHOWN_STATUSES = ['pendente', 'agendado', 'realizado', 'faltou'];

// ação -> { from: estados permitidos, to: novo estado }
export const TRANSITIONS = {
  confirmar: { from: ['pendente'], to: 'agendado' },
  recusar: { from: ['pendente'], to: 'recusado' },
  agendar: { from: ['por_agendar'], to: 'agendado' },
  reagendar: { from: ['pendente', 'agendado'], to: null }, // mantém o estado
  desmarcar: { from: ['agendado'], to: 'por_agendar', source: 'direto' },
  cancelar: { from: ['por_agendar', 'pendente', 'agendado'], to: 'cancelado' },
  realizado: { from: ['agendado', 'faltou'], to: 'realizado' },
  faltou: { from: ['agendado'], to: 'faltou' },
  anular_realizado: { from: ['realizado'], to: 'agendado' },
};

export function canTransition(action, status, source = 'direto') {
  const t = TRANSITIONS[action];
  return Boolean(t && t.from.includes(status) && (!t.source || t.source === source));
}

// Percurso: as estações por onde o exame tem de passar até ficar fechado.
// Cada estação fica 'done', 'next' (é a vez de alguém), 'todo' (ainda não),
// 'draft' (relatório em rascunho), 'fail' (faltou/recusado) ou 'off' (não se aplica).
export const STATIONS = {
  secretariado: [
    { key: 'confirmado', label: 'Confirmado' },
    { key: 'realizado', label: 'Realizado' },
    { key: 'relatorio', label: 'Relatório validado' },
    { key: 'executado', label: 'Executado no Siima' },
  ],
  direto: [
    { key: 'agendado', label: 'Agendado' },
    { key: 'marcado', label: 'Marcado no Siima' },
    { key: 'realizado', label: 'Realizado' },
    { key: 'relatorio', label: 'Relatório validado' },
    { key: 'executado', label: 'Executado no Siima' },
  ],
};

export const sourceOf = (e) => (e.source === 'secretariado' ? 'secretariado' : 'direto');

export function examTrack(e, today) {
  const s = e.status;
  const source = sourceOf(e);
  const stations = STATIONS[source];
  if (s === 'cancelado') return { stations, states: stations.map(() => 'off'), summary: 'Cancelado', tone: 'muted' };
  if (s === 'recusado') return { stations, states: stations.map((_, i) => (i === 0 ? 'fail' : 'off')), summary: 'Recusado', tone: 'fail' };

  const isPastOrToday = Boolean(e.starts_at && e.starts_at.slice(0, 10) <= today);
  const after = [
    s === 'realizado' ? 'done' : s === 'faltou' ? 'fail' : s === 'agendado' && isPastOrToday ? 'next' : 'todo',
    s === 'faltou' ? 'off' : e.report_status === 'validado' ? 'done' : s === 'realizado' ? (e.report_status === 'rascunho' ? 'draft' : 'next') : 'todo',
    s === 'faltou' ? 'off' : e.siima_registered_at ? 'done' : s === 'realizado' ? 'next' : 'todo',
  ];
  const before = source === 'secretariado'
    ? [s === 'pendente' ? 'next' : 'done']
    : [e.starts_at && s !== 'por_agendar' ? 'done' : 'next',
      e.siima_booked_at ? 'done' : s === 'agendado' || s === 'realizado' ? 'next' : 'todo'];
  const states = [...before, ...after];

  let summary;
  let tone = 'pending';
  if (e.change_kind === 'mover') summary = 'Alteração de hora pedida';
  else if (e.change_kind === 'cancelar') summary = 'Cancelamento pedido';
  else if (s === 'pendente') summary = 'Por confirmar';
  else if (s === 'por_agendar') summary = 'Por agendar';
  else if (s === 'faltou') { summary = 'Faltou'; tone = 'fail'; } else if (s === 'agendado') {
    if (source === 'direto' && !e.siima_booked_at) summary = 'Por marcar no Siima';
    else if (isPastOrToday) summary = 'Por realizar';
    else { summary = source === 'secretariado' ? 'Confirmado' : 'Marcado'; tone = 'quiet'; }
  } else {
    const missing = [];
    if (e.report_status !== 'validado') missing.push(e.report_status === 'rascunho' ? 'relatório em rascunho' : 'relatório');
    if (!e.siima_registered_at) missing.push('executar no Siima');
    if (!missing.length) { summary = 'Concluído'; tone = 'done'; } else summary = `Falta ${missing.join(' e ')}`;
  }
  return { stations, states, summary, tone };
}

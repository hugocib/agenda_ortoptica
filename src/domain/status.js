// Máquina de estados dos exames. Todas as mudanças passam por aqui, para que
// não haja transições impossíveis (p. ex. registar no Siima um exame que não foi feito).

export const STATUS_LABEL = {
  por_agendar: 'Por agendar',
  agendado: 'Agendado',
  realizado: 'Realizado',
  faltou: 'Faltou',
  cancelado: 'Cancelado',
};

export const ORIGIN_LABEL = {
  externo: 'Externo',
  projeto: 'Projeto interno',
  ensaio: 'Ensaio clínico',
};

// ação -> { from: estados permitidos, to: novo estado, roles }
export const TRANSITIONS = {
  agendar: { from: ['por_agendar'], to: 'agendado', roles: ['ortoptista', 'secretariado'] },
  reagendar: { from: ['agendado'], to: 'agendado', roles: ['ortoptista', 'secretariado'] },
  desmarcar: { from: ['agendado'], to: 'por_agendar', roles: ['ortoptista', 'secretariado'] },
  cancelar: { from: ['por_agendar', 'agendado'], to: 'cancelado', roles: ['ortoptista', 'secretariado'] },
  realizado: { from: ['agendado', 'faltou'], to: 'realizado', roles: ['ortoptista'] },
  faltou: { from: ['agendado'], to: 'faltou', roles: ['ortoptista'] },
  anular_realizado: { from: ['realizado'], to: 'agendado', roles: ['ortoptista'] },
};

// Percurso de um exame: as cinco estações por onde tem de passar até ficar fechado.
// Cada estação fica 'done', 'next' (falta fazer — é a vez de alguém), 'todo' (ainda não),
// 'draft' (relatório em rascunho), 'fail' (faltou) ou 'off' (cancelado / não se aplica).
export const STATIONS = [
  { key: 'agendado', label: 'Agendado', who: 'secretariado' },
  { key: 'marcado', label: 'Marcado no Siima', who: 'secretariado' },
  { key: 'realizado', label: 'Realizado', who: 'ortoptista' },
  { key: 'relatorio', label: 'Relatório validado', who: 'ortoptista' },
  { key: 'registado', label: 'Registado no Siima', who: 'ortoptista' },
];

export function examTrack(e, today) {
  const s = e.status;
  if (s === 'cancelado') {
    return { states: STATIONS.map(() => 'off'), summary: 'Cancelado', tone: 'muted' };
  }
  const isPastOrToday = Boolean(e.starts_at && e.starts_at.slice(0, 10) <= today);
  const states = [
    e.starts_at && s !== 'por_agendar' ? 'done' : 'next',
    e.siima_booked_at ? 'done' : s === 'agendado' || s === 'realizado' ? 'next' : 'todo',
    s === 'realizado' ? 'done' : s === 'faltou' ? 'fail' : s === 'agendado' && isPastOrToday ? 'next' : 'todo',
    s === 'faltou' ? 'off' : e.report_status === 'validado' ? 'done' : s === 'realizado' ? (e.report_status === 'rascunho' ? 'draft' : 'next') : 'todo',
    s === 'faltou' ? 'off' : e.siima_registered_at ? 'done' : s === 'realizado' ? 'next' : 'todo',
  ];
  let summary;
  let tone = 'pending';
  if (s === 'por_agendar') summary = 'Por agendar';
  else if (s === 'faltou') { summary = 'Faltou'; tone = 'fail'; }
  else if (s === 'agendado') {
    if (!e.siima_booked_at) summary = 'Por marcar no Siima';
    else if (isPastOrToday) summary = 'Por realizar';
    else { summary = 'Marcado'; tone = 'quiet'; }
  } else {
    const missing = [];
    if (e.report_status !== 'validado') missing.push(e.report_status === 'rascunho' ? 'relatório em rascunho' : 'relatório');
    if (!e.siima_registered_at) missing.push('registo no Siima');
    if (!missing.length) { summary = 'Concluído'; tone = 'done'; }
    else summary = `Falta ${missing.join(' e ')}`;
  }
  return { states, summary, tone };
}

export function canTransition(action, status, role) {
  const t = TRANSITIONS[action];
  return Boolean(t && t.from.includes(status) && t.roles.includes(role));
}

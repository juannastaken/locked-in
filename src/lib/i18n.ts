export type Lang = 'pt' | 'en';

let current: Lang = 'pt';

export function setLang(l: Lang): void {
  current = l;
}

export function getLang(): Lang {
  return current;
}

/** BCP-47 locale for date/time formatting, following the app language. */
export function dateLocale(): string {
  return current === 'en' ? 'en-US' : 'pt-BR';
}

const dict: Record<string, { pt: string; en: string }> = {
  // nav
  'tab.home': { pt: 'Foco', en: 'Focus' },
  'tab.checkin': { pt: 'Check-in', en: 'Check-in' },
  'tab.habits': { pt: 'Hábitos', en: 'Habits' },
  'tab.week': { pt: 'Semana', en: 'Week' },
  'tab.log': { pt: 'Histórico', en: 'History' },
  'tab.stats': { pt: 'Stats', en: 'Stats' },
  'tab.chat': { pt: 'Chat', en: 'Chat' },
  'tab.settings': { pt: 'Ajustes', en: 'Settings' },

  // first run
  'firstrun.title': { pt: 'escolhe teu idioma', en: 'pick your language' },
  'firstrun.sub': {
    pt: 'dá pra trocar depois nos Ajustes',
    en: 'you can change it later in Settings',
  },

  // home
  'home.greeting.dawn': { pt: 'boa madrugada', en: 'up late' },
  'home.greeting.morning': { pt: 'bom dia', en: 'good morning' },
  'home.greeting.afternoon': { pt: 'boa tarde', en: 'good afternoon' },
  'home.greeting.evening': { pt: 'boa noite', en: 'good evening' },
  'home.task.placeholder': { pt: 'O que você vai fazer agora?', en: 'What are you working on?' },
  'home.project.placeholder': { pt: 'projeto (opcional)', en: 'project (optional)' },
  'home.project.other': { pt: 'outro projeto…', en: 'other project…' },
  'home.lockin': { pt: 'LOCK IN', en: 'LOCK IN' },
  'home.continue': { pt: 'continuar:', en: 'continue:' },
  'home.continue.title': {
    pt: 'Começar outro bloco com a mesma task',
    en: 'Start another block with the same task',
  },
  'home.today': { pt: 'locked in hoje', en: 'locked in today' },
  'home.noblocks': { pt: 'nenhum bloco ainda', en: 'no blocks yet' },
  'home.block': { pt: 'bloco', en: 'block' },
  'home.blocks': { pt: 'blocos', en: 'blocks' },
  'home.best': { pt: 'melhor', en: 'best' },
  'home.goalhit': { pt: 'meta batida 🔥', en: 'goal hit 🔥' },
  'home.goalleft': { pt: 'faltam {0} pra meta', en: '{0} left to goal' },
  'home.goal': { pt: 'meta', en: 'goal' },
  'home.lockedin': { pt: 'locked in', en: 'locked in' },
  'home.focusing': { pt: 'Focando em', en: 'Focusing on' },
  'home.stop': { pt: 'Parar sessão', en: 'Stop session' },
  'home.pause': { pt: 'Pausar', en: 'Pause' },
  'home.resume': { pt: 'Continuar', en: 'Resume' },
  'home.paused': { pt: 'pausado', en: 'paused' },
  'home.paused.hint': {
    pt: 'timer congelado — esse tempo não conta no bloco',
    en: "timer frozen — this time doesn't count",
  },
  'home.absurd': {
    pt: 'Essa sessão já passou de 6h. Ainda aí ou esqueceu rodando?',
    en: 'This session passed 6h. Still there or did you forget it?',
  },
  'home.afk.q': { pt: 'Ficou {0} fora. Descontar do bloco?', en: 'Away for {0}. Deduct it?' },
  'home.afk.yes': { pt: 'Descontar', en: 'Deduct' },
  'home.afk.no': { pt: 'Tava trabalhando', en: 'I was working' },
  'home.rating.title': { pt: 'Bloco encerrado', en: 'Block finished' },
  'home.rating.q': { pt: 'Como foi o foco?', en: 'How was your focus?' },
  'home.rating.back': { pt: 'voltar pra sessão', en: 'back to session' },
  'home.rating.optional': { pt: 'opcional, pode pular', en: 'optional, skip if you want' },
  'home.rating.1': { pt: 'caótico', en: 'chaotic' },
  'home.rating.2': { pt: 'disperso', en: 'scattered' },
  'home.rating.3': { pt: 'ok', en: 'ok' },
  'home.rating.4': { pt: 'no ritmo', en: 'in rhythm' },
  'home.rating.5': { pt: 'cirúrgico', en: 'surgical' },
  'home.notes.placeholder': {
    pt: 'O que travou / o que rendeu? (opcional)',
    en: 'What blocked you / what worked? (optional)',
  },
  'home.break.q': { pt: 'Break antes do próximo?', en: 'Break before the next one?' },
  'home.break.none': { pt: 'Sem break', en: 'No break' },
  'home.save': { pt: 'Salvar bloco', en: 'Save block' },
  'home.break.label': { pt: 'em break', en: 'on break' },
  'home.break.over': { pt: 'break estourado', en: 'break overrun' },
  'home.break.planned': { pt: '{0} planejado', en: '{0} planned' },
  'home.break.honest': { pt: 'sem julgamento, só registrando', en: 'no judgement, just data' },
  'home.break.more': { pt: 'Bora mais um bloco?', en: 'One more block?' },
  'home.break.backfocus': { pt: 'Voltar a focar', en: 'Back to focus' },

  // chat
  'chat.nokey.title': { pt: 'cadê a chave?', en: "where's the key?" },
  'chat.nokey.sub': {
    pt: 'pra conversar comigo sobre seus dados, cola uma chave da API Anthropic nos Ajustes.',
    en: 'to chat with me about your data, paste an Anthropic API key in Settings.',
  },
  'chat.nokey.btn': { pt: 'abrir Ajustes', en: 'open Settings' },
  'chat.empty.sub': {
    pt: 'seus dados tão todos aqui comigo. pergunta qualquer coisa.',
    en: 'all your data lives here with me. ask anything.',
  },
  'chat.placeholder': {
    pt: 'pergunta aí — tipo "quantas horas essa semana?"',
    en: 'ask away — like "how many hours this week?"',
  },
  'chat.placeholder.busy': { pt: 'peraí…', en: 'hold on…' },
  'chat.reasoning': { pt: 'como cheguei nisso', en: 'how I got this' },
  'chat.clear': { pt: 'limpar conversa', en: 'clear chat' },
  'chat.new': { pt: 'nova conversa', en: 'new chat' },
  'chat.conversations': { pt: 'conversas', en: 'chats' },
  'chat.delete.confirm': { pt: 'certeza?', en: 'sure?' },
  'chat.today': { pt: 'hoje', en: 'today' },
  'chat.yesterday': { pt: 'ontem', en: 'yesterday' },
  'chat.error': { pt: 'deu ruim: {0}', en: 'something broke: {0}' },
  'chat.error.auth': {
    pt: 'chave da API inválida — confere nos Ajustes',
    en: 'invalid API key — check Settings',
  },
  'chat.error.rate': {
    pt: 'muita pergunta rápido demais, respira e tenta de novo',
    en: 'too many questions too fast, breathe and retry',
  },

  // settings
  'set.profile': { pt: 'Perfil', en: 'Profile' },
  'set.name': { pt: 'Seu nome', en: 'Your name' },
  'set.name.hint': { pt: 'usado na saudação da tela de foco', en: 'used in the focus screen greeting' },
  'set.name.placeholder': { pt: 'como te chamar?', en: 'what should I call you?' },
  'set.language': { pt: 'Idioma', en: 'Language' },
  'set.focus': { pt: 'Foco', en: 'Focus' },
  'set.goal': { pt: 'Meta diária', en: 'Daily goal' },
  'set.goal.hint': { pt: 'horas de foco pra contar streak', en: 'focus hours to count streaks' },
  'set.intel': { pt: 'Inteligência', en: 'Intelligence' },
  'set.mirror': { pt: 'Espelho de foco', en: 'Focus mirror' },
  'set.mirror.hint': {
    pt: 'registra quais apps você usou durante a sessão',
    en: 'records which apps you used during a session',
  },
  'set.afk': { pt: 'AFK honesto', en: 'Honest AFK' },
  'set.afk.hint': {
    pt: 'detecta quando você sai do PC e pergunta se desconta',
    en: 'detects when you leave the PC and asks to deduct',
  },
  'set.afk.threshold': { pt: 'Limiar de AFK', en: 'AFK threshold' },
  'set.afk.threshold.hint': {
    pt: 'minutos sem teclado/mouse pra contar como fora',
    en: 'minutes without input to count as away',
  },
  'set.burnout': { pt: 'Anti-burnout', en: 'Anti-burnout' },
  'set.burnout.hint': {
    pt: 'avisa quando passar do limite diário — descansar também é progresso',
    en: 'warns past the daily limit — rest is progress too',
  },
  'set.burnout.limit': { pt: 'Limite diário', en: 'Daily limit' },
  'set.autoend': { pt: 'Auto-encerrar sessão', en: 'Auto-end session' },
  'set.autoend.hint': {
    pt: 'esqueceu rodando e saiu? fecha sozinha no último input',
    en: 'forgot it running? closes itself at your last input',
  },
  'set.autoend.after': { pt: 'Auto-encerrar após', en: 'Auto-end after' },
  'set.checkin': { pt: 'Check-in horário', en: 'Hourly check-in' },
  'set.checkin.enable': { pt: 'Ativar', en: 'Enable' },
  'set.checkin.enable.hint': {
    pt: 'popup no canto da tela perguntando o que você fez na última hora',
    en: 'corner popup asking what you got done in the last hour',
  },
  'set.checkin.interval': { pt: 'Intervalo', en: 'Interval' },
  'set.checkin.interval.hint': {
    pt: 'de quanto em quanto tempo perguntar',
    en: 'how often to ask',
  },
  'set.checkin.onlysession': { pt: 'Só durante sessão', en: 'Only during sessions' },
  'set.checkin.onlysession.hint': {
    pt: 'não pergunta se não tiver sessão rodando',
    en: 'stays quiet unless a session is running',
  },
  'set.checkin.test': { pt: 'Ver como fica', en: 'Preview it' },
  'set.checkin.test.hint': {
    pt: 'dispara o popup agora, só de teste — não grava nada',
    en: 'fires the popup right now, preview only — saves nothing',
  },
  'set.checkin.test.btn': { pt: 'Testar agora', en: 'Test now' },
  'set.nudge.test.hint': {
    pt: 'dispara o aviso de procrastinação agora, só pra ver',
    en: 'fires the procrastination nudge right now, just to see it',
  },
  'set.nudge': { pt: 'Anti-procrastinação', en: 'Anti-procrastination' },
  'set.nudge.enable': { pt: 'Ativar', en: 'Enable' },
  'set.nudge.enable.hint': {
    pt: 'aviso no canto da tela quando você enrola tempo demais',
    en: 'corner nudge when you slack for too long',
  },
  'set.nudge.threshold': { pt: 'Tolerância', en: 'Tolerance' },
  'set.nudge.threshold.hint': {
    pt: 'minutos seguidos de distração antes do aviso',
    en: 'continuous minutes of distraction before the nudge',
  },
  'set.nudge.apps': { pt: 'Apps e sites vigiados', en: 'Watched apps and sites' },
  'set.nudge.apps.hint': {
    pt: 'separa por vírgula — vale nome de app ou pedaço do título da janela',
    en: 'comma-separated — app names or window-title fragments',
  },
  'set.ai': { pt: 'IA', en: 'AI' },
  'set.ai.key': { pt: 'Chave da API Anthropic', en: 'Anthropic API key' },
  'set.ai.hint': {
    pt: 'Habilita o Chat. Crie em console.anthropic.com → API Keys. Fica só no seu banco local.',
    en: 'Enables Chat. Create at console.anthropic.com → API Keys. Stays in your local db only.',
  },
  'set.autotrack': { pt: 'Auto-track', en: 'Auto-track' },
  'set.autotrack.enable': { pt: 'Ativar', en: 'Enable' },
  'set.autotrack.enable.hint': {
    pt: 'abriu um app da lista → a sessão começa sozinha com o nome dele; só para quando você pausar/parar',
    en: 'open a listed app → the session starts itself with its name; only stops when you pause/stop',
  },
  'set.autotrack.overlay': { pt: 'Mostrar overlay ao iniciar', en: 'Show overlay on start' },
  'set.autotrack.overlay.hint': {
    pt: 'o timer flutuante aparece quando a sessão automática começa (desligado, conta igual)',
    en: 'the floating timer pops up when the auto session starts (off = still counts)',
  },
  'set.autotrack.apps': { pt: 'Apps de trabalho', en: 'Work apps' },
  'set.autotrack.apps.hint': {
    pt: 'separa por vírgula — nome do app ou pedaço do título da janela',
    en: 'comma-separated — app names or window-title fragments',
  },
  'set.refboard': { pt: 'Ref Board', en: 'Ref Board' },
  'set.refboard.enable': { pt: 'Ativar', en: 'Enable' },
  'set.refboard.hint': {
    pt: 'janela livre de referências estilo PureRef — arrasta imagens do PC pra dentro',
    en: 'PureRef-style free reference window — drag images from your PC into it',
  },
  'ref.title': { pt: 'refs', en: 'refs' },
  'ref.empty': {
    pt: 'arrasta imagens do teu PC pra cá',
    en: 'drag images from your PC in here',
  },
  'ref.drop': { pt: 'solta aqui', en: 'drop it here' },
  'ref.pin': { pt: 'sempre no topo', en: 'always on top' },
  'ref.close': { pt: 'fechar (religa nos Ajustes)', en: 'close (re-enable in Settings)' },
  'ref.front': { pt: 'frente', en: 'front' },
  'ref.back': { pt: 'trás', en: 'back' },
  'ref.delete': { pt: 'excluir', en: 'delete' },

  'set.overlay': { pt: 'Overlay flutuante', en: 'Floating overlay' },
  'set.overlay.enable': { pt: 'Ativar', en: 'Enable' },
  'set.overlay.enable.hint': {
    pt: 'janela mini por cima de tudo, arrastável',
    en: 'mini always-on-top window, draggable',
  },
  'set.overlay.opacity': { pt: 'Opacidade', en: 'Opacity' },
  'set.overlay.opacity.hint': {
    pt: 'quando o mouse não tá em cima (hover = 100%)',
    en: 'when not hovered (hover = 100%)',
  },
  'set.overlay.size': { pt: 'Tamanho', en: 'Size' },
  'set.size.sm': { pt: 'P', en: 'S' },
  'set.size.md': { pt: 'M', en: 'M' },
  'set.size.lg': { pt: 'G', en: 'L' },
  'set.overlay.task': { pt: 'Mostrar task', en: 'Show task' },
  'set.overlay.task.hint': { pt: 'nome da task embaixo do timer', en: 'task name under the timer' },
  'set.overlay.goal': { pt: 'Barra de meta', en: 'Goal bar' },
  'set.overlay.goal.hint': {
    pt: 'progresso do dia na base do overlay',
    en: "day's progress at the overlay bottom",
  },
  'set.appearance': { pt: 'Aparência', en: 'Appearance' },
  'set.accent': { pt: 'Cor de destaque', en: 'Accent color' },
  'set.accent.hint': { pt: 'timer, botões e heatmap', en: 'timer, buttons and heatmap' },
  'set.accent.lime': { pt: 'Lima', en: 'Lime' },
  'set.accent.orange': { pt: 'Laranja', en: 'Orange' },
  'set.accent.blue': { pt: 'Azul', en: 'Blue' },
  'set.accent.purple': { pt: 'Roxo', en: 'Purple' },
  'set.accent.pink': { pt: 'Rosa', en: 'Pink' },
  'set.notifications': { pt: 'Notificações', en: 'Notifications' },
  'set.sound': { pt: 'Som', en: 'Sound' },
  'set.sound.hint': {
    pt: 'chime suave em check-in, fim de break e marcos',
    en: 'soft chime on check-ins, break end and milestones',
  },
  'set.notify.break': { pt: 'Fim de break', en: 'Break end' },
  'set.notify.milestones': { pt: 'Marcos', en: 'Milestones' },
  'set.notify.milestones.hint': {
    pt: '10h num projeto, streaks, recordes',
    en: '10h on a project, streaks, records',
  },
  'set.data': { pt: 'Dados', en: 'Data' },
  'set.export': { pt: 'Exportar tudo', en: 'Export everything' },
  'set.export.hint': {
    pt: 'JSON com todas as sessões. Backup automático diário já roda sozinho (pasta backups, últimos 14 dias).',
    en: 'JSON with every session. Daily auto-backup already runs (backups folder, last 14 days).',
  },
  'set.export.btn': { pt: 'Exportar', en: 'Export' },
  'set.export.busy': { pt: 'Exportando…', en: 'Exporting…' },
  'set.export.done': { pt: 'Dados exportados', en: 'Data exported' },
  'set.loading': { pt: 'Carregando…', en: 'Loading…' },

  // overlay
  'ov.today': { pt: '{0} hoje', en: '{0} today' },
  'ov.none': { pt: 'nenhum bloco hoje', en: 'no blocks today' },
  'ov.break': { pt: 'em break', en: 'on break' },
  'ov.overrun': { pt: 'break estourado', en: 'break overrun' },
  'ov.stop': { pt: 'Parar sessão', en: 'Stop session' },
  'ov.pause': { pt: 'Pausar', en: 'Pause' },
  'ov.resume': { pt: 'Continuar', en: 'Resume' },
  'ov.paused': { pt: 'pausado', en: 'paused' },
  'ov.back': { pt: 'Voltar a focar', en: 'Back to focus' },
  'ov.open': { pt: 'Abrir Locked In', en: 'Open Locked In' },

  // check-in popup + tab
  'ci.popup.title': { pt: 'Hora do check-in', en: 'Time to check in' },
  'ci.popup.q.pre': { pt: 'O que você fez das', en: 'What did you get done in' },
  'ci.popup.placeholder': {
    pt: 'Uma linha basta. O que fez, o que vem…',
    en: "One line is enough. What you did, what's next…",
  },
  'ci.popup.skip': { pt: 'Pular', en: 'Skip' },
  'ci.popup.save': { pt: 'Salvar log', en: 'Save log' },
  'ci.popup.hint.save': { pt: 'salva', en: 'to save' },
  'ci.popup.hint.skip': { pt: 'pula', en: 'to skip' },
  'ci.thishour': { pt: 'Essa hora é', en: 'This hour is' },
  'ci.next': { pt: 'Próximo check-in', en: 'Next check-in' },
  'ci.off': {
    pt: 'check-in desligado — liga nos Ajustes',
    en: 'check-ins are off — enable them in Settings',
  },
  'ci.onlysession': { pt: 'só durante sessão', en: 'sessions only' },
  'ci.logged': { pt: 'REGISTRADAS', en: 'LOGGED' },
  'ci.streak': { pt: 'STREAK', en: 'STREAK' },
  'ci.skipped': { pt: 'PULADAS', en: 'SKIPPED' },
  'ci.todaylog': { pt: 'Registro de hoje', en: "Today's log" },
  'ci.skippedrow': { pt: 'Pulou', en: 'Skipped' },
  'ci.empty': { pt: 'nada registrado hoje ainda', en: 'nothing logged today yet' },
  'ci.input.placeholder': { pt: 'O que você fez essa hora?', en: 'What did you get done this hour?' },
  'ci.export': { pt: 'Exportar', en: 'Export' },
  'ci.clear': { pt: 'Limpar', en: 'Clear' },
  'ci.clear.confirm': { pt: 'apagar tudo?', en: 'delete all?' },
  'ci.nostreak': {
    pt: 'sem streak ainda — registra a próxima hora 😉',
    en: 'no streak yet — log the next hour 😉',
  },
  'ci.streakon': { pt: '{0} seguidas 🔥', en: '{0} in a row 🔥' },

  // update popup + installer screen
  'up.title': { pt: 'Atualização disponível', en: 'Update available' },
  'up.body': {
    pt: 'saiu versão nova do Locked In. Um clique: baixa, instala e reabre sozinho 🚀',
    en: 'a new Locked In version is out. One click: downloads, installs and reopens itself 🚀',
  },
  'up.get': { pt: 'Atualizar agora', en: 'Update now' },
  'up.later': { pt: 'Depois', en: 'Later' },
  'up.installing': { pt: 'Instalando', en: 'Installing' },
  'up.installing.sub': {
    pt: 'não fecha o app — ele reinicia sozinho na versão nova',
    en: "don't close the app — it restarts itself on the new version",
  },
  'up.error': { pt: 'atualização falhou: {0}', en: 'update failed: {0}' },

  // nudge popup
  'nudge.title': { pt: 'ei. LOCKED IN.', en: 'hey. LOCKED IN.' },
  'nudge.body': {
    pt: '{0} aberto há {1}min. Bora voltar pro trampo?',
    en: '{0} open for {1}min. Back to work?',
  },
  'nudge.back': { pt: 'voltei 💪', en: "I'm back 💪" },
  'nudge.5more': { pt: 'só +5min ✋', en: 'just 5 more ✋' },

  // habits
  'hab.title': { pt: 'Hábitos da semana', en: 'Weekly habits' },
  'hab.sub': {
    pt: 'sem horário, sem dia fixo — fez quando deu, marcou',
    en: 'no schedule, no fixed day — did it, tick it',
  },
  'hab.hit': { pt: 'alvos batidos', en: 'targets hit' },
  'hab.streak': { pt: '🔥 {0} semanas seguidas', en: '🔥 {0} weeks in a row' },
  'hab.done': { pt: 'alvo batido ✓', en: 'target hit ✓' },
  'hab.left': { pt: 'faltam {0} essa semana', en: '{0} left this week' },
  'hab.archive': { pt: 'arquivar', en: 'archive' },
  'hab.new': { pt: 'novo hábito', en: 'new habit' },
  'hab.new.placeholder': { pt: 'treinar, ler, dormir cedo…', en: 'workout, read, sleep early…' },
  'hab.emoji.title': { pt: 'Emoji — Win + . abre o seletor', en: 'Emoji — Win + . opens the picker' },
  'hab.perweek': { pt: '/sem', en: '/wk' },
  'hab.create': { pt: 'Criar', en: 'Create' },
  'hab.chips.add': { pt: '+ hábitos da semana', en: '+ weekly habits' },
  'hab.manage': { pt: 'Gerenciar hábitos', en: 'Manage habits' },
  'hab.chip.title': {
    pt: '{0} · {1}/{2} essa semana\nclique = hoje · clique direito = ontem',
    en: '{0} · {1}/{2} this week\nclick = today · right-click = yesterday',
  },
  'hab.last8': { pt: 'últimas 8 semanas', en: 'last 8 weeks' },

  // week
  'week.this': { pt: 'Essa semana', en: 'This week' },
  'week.last': { pt: 'Semana passada', en: 'Last week' },
  'week.vsavg': { pt: '{0}% vs sua média', en: '{0}% vs your average' },
  'week.avgtitle': {
    pt: 'média das últimas {0} semanas: {1}',
    en: 'average of the last {0} weeks: {1}',
  },
  'week.goaldays': { pt: 'dias com meta ({0}h)', en: 'days on goal ({0}h)' },
  'week.bestday': { pt: 'melhor dia', en: 'best day' },
  'week.avgfocus': { pt: 'foco médio da semana', en: 'week average focus' },
  'week.apps': { pt: 'Onde a semana foi', en: 'Where the week went' },
  'week.dayavgtitle': { pt: 'sua média de {0}: {1}', en: 'your {0} average: {1}' },

  // log / history
  'log.today': { pt: 'Hoje', en: 'Today' },
  'log.yesterday': { pt: 'Ontem', en: 'Yesterday' },
  'log.in': { pt: '{0} em {1}', en: '{0} across {1}' },
  'log.main': { pt: 'principal: {0}', en: 'top: {0}' },
  'log.best': { pt: 'melhor: {0}', en: 'best: {0}' },
  'log.empty': { pt: 'Nenhum bloco registrado ainda.', en: 'No blocks logged yet.' },
  'log.empty.sub': {
    pt: 'Seu histórico aparece aqui depois do primeiro LOCK IN.',
    en: 'Your history shows up here after your first LOCK IN.',
  },
  'log.focusavg': { pt: '★ {0} foco médio', en: '★ {0} avg focus' },
  'log.afkdiscount': { pt: '{0} afk descontado', en: '{0} afk deducted' },
  'log.focus5': { pt: 'foco {0}/5', en: 'focus {0}/5' },
  'log.norating': { pt: 'sem rating', en: 'no rating' },
  'log.project': { pt: 'Projeto', en: 'Project' },
  'log.notes': { pt: 'Notas', en: 'Notes' },
  'log.paused': { pt: '⏸ {0} pausado', en: '⏸ {0} paused' },

  // timeline
  'tl.afk': { pt: 'fora do PC', en: 'away from PC' },
  'tl.paused': { pt: 'pausado', en: 'paused' },
  'tl.break': { pt: 'break · planejado {0}', en: 'break · planned {0}' },
  'tl.overrun': { pt: ' · estourou {0}', en: ' · overran {0}' },
  'tl.now': { pt: 'agora', en: 'now' },

  // stats
  'stats.today': { pt: 'hoje', en: 'today' },
  'stats.7days': { pt: 'últimos 7 dias', en: 'last 7 days' },
  'stats.goalstreak.one': { pt: 'dia batendo a meta', en: 'day hitting the goal' },
  'stats.goalstreak.many': { pt: 'dias batendo a meta', en: 'days hitting the goal' },
  'stats.overrun': { pt: 'estouro médio de break', en: 'avg break overrun' },
  'stats.6months': { pt: 'Últimos 6 meses', en: 'Last 6 months' },
  'stats.less': { pt: 'menos', en: 'less' },
  'stats.more': { pt: 'mais', en: 'more' },
  'stats.hoursperday': { pt: 'Horas por dia', en: 'Hours per day' },
  'stats.focus': { pt: 'foco', en: 'focus' },
  'stats.besthour': { pt: 'Melhor hora por projeto', en: 'Best hour per project' },
  'stats.focusshare': { pt: '{0}% do foco', en: '{0}% of focus' },
  'stats.distraction': { pt: 'Perfil de distração', en: 'Distraction profile' },
  'stats.distraction.hint': {
    pt: 'Rating médio dos blocos onde cada app apareceu (10%+ do tempo)',
    en: 'Average focus rating of blocks where each app showed up (10%+ of the time)',
  },
  'stats.blocks': { pt: '{0} blocos', en: '{0} blocks' },
  'stats.byproject': { pt: 'Por projeto', en: 'By project' },
  'stats.nodata': { pt: 'Sem dados ainda. Bora pro primeiro bloco?', en: 'No data yet. First block time?' },

  // milestones
  'mile.proj': { pt: '{0}h focadas em {1} 🏆', en: '{0}h focused on {1} 🏆' },
  'mile.blocks': { pt: '{0} blocos registrados 🔥', en: '{0} blocks logged 🔥' },
  'mile.streak': {
    pt: '{0} dias seguidos batendo a meta ⚡',
    en: '{0} days in a row hitting your goal ⚡',
  },

  // session lifecycle
  'sess.autoend.note': {
    pt: '(encerrada automaticamente — você saiu do PC)',
    en: '(auto-ended — you left the PC)',
  },
  'sess.pausedend.note': {
    pt: '(encerrada automaticamente — ficou pausada)',
    en: '(auto-ended — left paused)',
  },
  'sess.recovered.note': {
    pt: '(recuperada após fechamento inesperado)',
    en: '(recovered after unexpected shutdown)',
  },
  'sess.autoend.toast': {
    pt: 'Sessão "{0}" encerrada sozinha — você saiu há {1}min. Salvei até o último input.',
    en: 'Session "{0}" ended itself — you left {1}min ago. Saved up to your last input.',
  },
  'sess.pausedend.toast': {
    pt: 'Sessão "{0}" encerrada — ficou pausada tempo demais. Salvei até a pausa.',
    en: 'Session "{0}" ended — paused for too long. Saved up to the pause.',
  },
  'burnout.msg': {
    pt: '{0}h focadas hoje. Já deu — descansa, amanhã continua.',
    en: "{0}h focused today. That's enough — rest, tomorrow continues.",
  },
  'notif.breakend': { pt: 'Break acabou. Bora mais um bloco?', en: 'Break over. One more block?' },

  // tray
  'tray.focusing': { pt: 'Focando: {0}', en: 'Focusing: {0}' },
  'tray.paused': { pt: 'Pausado', en: 'Paused' },
  'tray.break': { pt: 'Em break', en: 'On break' },

  // misc shared
  'misc.save': { pt: 'Salvar', en: 'Save' },
  'misc.cancel': { pt: 'Cancelar', en: 'Cancel' },
  'misc.edit': { pt: 'editar', en: 'edit' },
  'misc.delete': { pt: 'excluir', en: 'delete' },
  'misc.confirm': { pt: 'confirmar?', en: 'confirm?' },
  'misc.sure': { pt: 'certeza?', en: 'sure?' },
  'misc.dec': { pt: 'diminuir', en: 'decrease' },
  'misc.inc': { pt: 'aumentar', en: 'increase' },
  'misc.noproject': { pt: 'Sem projeto', en: 'No project' },
  'misc.weekdays.letters': { pt: 'S,T,Q,Q,S,S,D', en: 'M,T,W,T,F,S,S' },
  'misc.weekdays.short': { pt: 'seg,ter,qua,qui,sex,sáb,dom', en: 'mon,tue,wed,thu,fri,sat,sun' },
  'misc.recovered.title': { pt: 'Sessão anterior não fechada', en: 'Unfinished previous session' },
  'misc.recovered.body': {
    pt: 'Você tinha uma sessão de "{0}" rodando. Salvar até o último registro ou descartar?',
    en: 'You had a "{0}" session running. Save up to the last heartbeat or discard?',
  },
  'misc.discard': { pt: 'Descartar', en: 'Discard' },
};

export function t(key: string, ...args: (string | number)[]): string {
  const entry = dict[key];
  let out = entry ? entry[current] : key;
  args.forEach((a, i) => {
    out = out.replace(`{${i}}`, String(a));
  });
  return out;
}

/** Weekday letters (mon..sun) in the current language. */
export function weekdayLetters(): string[] {
  return t('misc.weekdays.letters').split(',');
}

/** Short weekday names (mon..sun) in the current language. */
export function weekdayShort(): string[] {
  return t('misc.weekdays.short').split(',');
}

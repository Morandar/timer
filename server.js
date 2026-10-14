const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const ROUTES = new Map([
  ['/', 'control.html'],
  ['/control', 'control.html'],
  ['/display', 'display.html'],
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};
const VALID_MAIN_MODES = ['timer', 'return', 'clock', 'pause', 'text', 'logo', 'blank'];
const VALID_CLOCK_STYLES = ['digital', 'analog'];
const VALID_LOGO_MOTIONS = ['dvd', 'float', 'static'];
const VALID_DISPLAY_FONTS = ['din', 'avenir', 'mono', 'serif'];
// Na Fly.io se templates ukládají na volume /data, lokálně vedle server.js
const DATA_DIR = process.env.DATA_DIR || ROOT;
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const KIOSK_STATUSES_FILE = path.join(DATA_DIR, 'kiosk-statuses.json');
const PAUSE_EVENTS_FILE = path.join(DATA_DIR, 'pause-events.json');
const VALID_KIOSK_STATUS_MODES = ['pause', 'return', 'timer', 'text'];

const DEFAULT_STATE = {
  mainMode: 'timer',
  durationSeconds: 15 * 60,
  remainingSeconds: 15 * 60,
  running: false,
  finished: false,
  endsAt: null,
  mainText: '',
  returnTime: '',
  clockStyle: 'digital',
  displayFont: 'din',
  clockFont: 'din',
  logoScale: 100,
  logoMotion: 'dvd',
  showSubtitle: false,
  subtitleText: '',
  showContact: false,
  contactName: '',
  contactPhone: '',
  activePauseId: null,
  updatedAt: Date.now(),
};

const DEFAULT_KIOSK_STATUSES = [
  {
    id: 'quick-break',
    name: 'Krátká pauza',
    mode: 'return',
    durationMinutes: 10,
    message: 'Omlouváme se, za chvíli jsme zpět.',
  },
  {
    id: 'lunch-break',
    name: 'Oběd',
    mode: 'return',
    durationMinutes: 30,
    message: 'Právě máme oběd. Děkujeme za trpělivost.',
  },
  {
    id: 'serving-customer',
    name: 'Obsluhuji zákazníka',
    mode: 'pause',
    durationMinutes: 0,
    message: 'Právě obsluhujeme zákazníka. Za chvíli jsme k dispozici.',
  },
  {
    id: 'technical-break',
    name: 'Technická přestávka',
    mode: 'pause',
    durationMinutes: 0,
    message: 'Probíhá krátká technická přestávka.',
  },
];

let templates = [];
let kioskStatuses = [];
let pauseEvents = [];

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadTemplates() {
  try {
    templates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
  } catch {
    templates = [];
  }
}

function saveTemplates() {
  try {
    ensureDataDir();
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  } catch {}
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKioskStatus(raw, fallback = {}) {
  const mode = VALID_KIOSK_STATUS_MODES.includes(raw?.mode) ? raw.mode : (fallback.mode || 'pause');
  return {
    id: String(raw?.id || fallback.id || makeId('status')).slice(0, 80),
    name: String(raw?.name || fallback.name || '').trim().slice(0, 80),
    mode,
    durationMinutes: clampInt(raw?.durationMinutes, 0, 999, fallback.durationMinutes || 0),
    message: String(raw?.message || '').trim().slice(0, 200),
    createdAt: Number(raw?.createdAt) || fallback.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function loadKioskStatuses() {
  try {
    const raw = JSON.parse(fs.readFileSync(KIOSK_STATUSES_FILE, 'utf8'));
    kioskStatuses = Array.isArray(raw) ? raw.map((item) => normalizeKioskStatus(item)).filter((item) => item.name) : [];
  } catch {
    kioskStatuses = DEFAULT_KIOSK_STATUSES.map((item) => normalizeKioskStatus(item, item));
    saveKioskStatuses();
  }
}

function saveKioskStatuses() {
  try {
    ensureDataDir();
    fs.writeFileSync(KIOSK_STATUSES_FILE, JSON.stringify(kioskStatuses, null, 2));
  } catch {}
}

function normalizePauseEvent(raw) {
  const startedAt = Number(raw?.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  const endedAt = raw?.endedAt == null ? null : Number(raw.endedAt);
  return {
    id: String(raw?.id || makeId('pause')).slice(0, 90),
    statusId: raw?.statusId ? String(raw.statusId).slice(0, 80) : null,
    statusName: String(raw?.statusName || 'Pauza').slice(0, 100),
    mode: VALID_KIOSK_STATUS_MODES.includes(raw?.mode) ? raw.mode : 'pause',
    plannedMinutes: clampInt(raw?.plannedMinutes, 0, 999, 0),
    startedAt,
    endedAt: Number.isFinite(endedAt) ? endedAt : null,
    endReason: raw?.endReason ? String(raw.endReason).slice(0, 60) : null,
  };
}

function loadPauseEvents() {
  try {
    const raw = JSON.parse(fs.readFileSync(PAUSE_EVENTS_FILE, 'utf8'));
    pauseEvents = Array.isArray(raw) ? raw.map(normalizePauseEvent).filter(Boolean).slice(0, 1000) : [];
  } catch {
    pauseEvents = [];
  }
}

function savePauseEvents() {
  try {
    ensureDataDir();
    fs.writeFileSync(PAUSE_EVENTS_FILE, JSON.stringify(pauseEvents.slice(0, 1000), null, 2));
  } catch {}
}

loadTemplates();
loadKioskStatuses();
loadPauseEvents();

const state = { ...DEFAULT_STATE };

const clients = new Set();
let lastKey = '';

function getIPv4Addresses() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      out.push({ name, address: item.address });
    }
  }
  return out;
}

function getPreferredAddress() {
  const list = getIPv4Addresses();
  const pref = list.find((i) => i.name === 'en0') || list[0];
  return pref ? pref.address : null;
}

// Na Fly.io vrátí https://o2-stanek.fly.dev, lokálně http://192.168.x.x:PORT
function getPublicBaseUrl() {
  if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  if (process.env.PUBLIC_URL)   return process.env.PUBLIC_URL.replace(/\/$/, '');
  const addr = getPreferredAddress();
  return addr ? `http://${addr}:${PORT}` : null;
}

function syncTimer() {
  if (!state.running || !state.endsAt) return;
  const left = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
  state.remainingSeconds = left;
  state.updatedAt = Date.now();
  if (left === 0) {
    state.running = false;
    state.finished = true;
    state.endsAt = null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeState(raw) {
  const next = { ...DEFAULT_STATE };
  if (!raw || typeof raw !== 'object') return next;

  if (VALID_MAIN_MODES.includes(raw.mainMode)) next.mainMode = raw.mainMode;
  next.durationSeconds = clampInt(raw.durationSeconds, 0, 999 * 60, next.durationSeconds);
  next.remainingSeconds = clampInt(raw.remainingSeconds, 0, 999 * 60, next.durationSeconds);
  next.running = Boolean(raw.running);
  next.finished = Boolean(raw.finished);
  next.endsAt = raw.endsAt == null ? null : Number(raw.endsAt);
  if (!Number.isFinite(next.endsAt)) next.endsAt = null;
  next.mainText = String(raw.mainText || '').slice(0, 300);
  next.returnTime = String(raw.returnTime || '').trim().slice(0, 5);
  if (VALID_CLOCK_STYLES.includes(raw.clockStyle)) next.clockStyle = raw.clockStyle;
  if (VALID_DISPLAY_FONTS.includes(raw.displayFont)) next.displayFont = raw.displayFont;
  if (VALID_DISPLAY_FONTS.includes(raw.clockFont)) next.clockFont = raw.clockFont;
  next.logoScale = clampInt(raw.logoScale, 40, 180, next.logoScale);
  if (VALID_LOGO_MOTIONS.includes(raw.logoMotion)) next.logoMotion = raw.logoMotion;
  next.showSubtitle = Boolean(raw.showSubtitle);
  next.subtitleText = String(raw.subtitleText || '').slice(0, 200);
  next.showContact = Boolean(raw.showContact);
  next.contactName = String(raw.contactName || '').slice(0, 100);
  next.contactPhone = String(raw.contactPhone || '').slice(0, 30);
  next.activePauseId = raw.activePauseId ? String(raw.activePauseId).slice(0, 90) : null;
  next.updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now();

  if (!next.running) next.endsAt = null;
  if (next.running && !next.endsAt) next.running = false;

  return next;
}

function persistableState() {
  syncTimer();
  return {
    mainMode: state.mainMode,
    durationSeconds: state.durationSeconds,
    remainingSeconds: state.remainingSeconds,
    running: state.running,
    finished: state.finished,
    endsAt: state.endsAt,
    mainText: state.mainText,
    returnTime: state.returnTime,
    clockStyle: state.clockStyle,
    displayFont: state.displayFont,
    clockFont: state.clockFont,
    logoScale: state.logoScale,
    logoMotion: state.logoMotion,
    showSubtitle: state.showSubtitle,
    subtitleText: state.subtitleText,
    showContact: state.showContact,
    contactName: state.contactName,
    contactPhone: state.contactPhone,
    activePauseId: state.activePauseId,
    updatedAt: state.updatedAt,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    Object.assign(state, normalizeState(saved));
    syncTimer();
  } catch {}
}

function saveState() {
  try {
    ensureDataDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(persistableState(), null, 2));
  } catch {}
}

loadState();

function getActivePauseEvent() {
  if (!state.activePauseId) return null;
  return pauseEvents.find((event) => event.id === state.activePauseId && !event.endedAt) || null;
}

function getPauseDurationSeconds(event, now = Date.now()) {
  if (!event) return 0;
  return Math.max(0, Math.round(((event.endedAt || now) - event.startedAt) / 1000));
}

function startPauseEvent({ statusId = null, statusName = 'Pauza', mode = 'pause', plannedMinutes = 0, startedAt = Date.now() } = {}) {
  const active = getActivePauseEvent();
  if (active) return active;

  const event = {
    id: makeId('pause'),
    statusId,
    statusName: String(statusName || 'Pauza').slice(0, 100),
    mode: VALID_KIOSK_STATUS_MODES.includes(mode) ? mode : 'pause',
    plannedMinutes: clampInt(plannedMinutes, 0, 999, 0),
    startedAt,
    endedAt: null,
    endReason: null,
  };
  pauseEvents.unshift(event);
  state.activePauseId = event.id;
  savePauseEvents();
  return event;
}

function endPauseEvent(reason = 'manual') {
  const active = getActivePauseEvent();
  state.activePauseId = null;
  if (!active) return null;
  active.endedAt = Date.now();
  active.endReason = reason;
  savePauseEvents();
  return active;
}

function getCzechTimePlusMinutes(minutes) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + minutes * 60 * 1000));
  const hour = parts.find((part) => part.type === 'hour')?.value || '00';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

function getCzechHour(timestamp) {
  const value = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
  return Math.max(0, Math.min(23, Number(value) || 0));
}

function recoverActivePause() {
  const active = getActivePauseEvent();
  if (active) return;
  state.activePauseId = null;
  if (state.mainMode === 'pause') {
    startPauseEvent({ statusName: 'Pauza', mode: 'pause', startedAt: state.updatedAt || Date.now() });
    saveState();
  }
}

recoverActivePause();

function createSnapshot() {
  syncTimer();
  const base = getPublicBaseUrl();
  const activePause = getActivePauseEvent();
  return {
    mainMode: state.mainMode,
    durationSeconds: state.durationSeconds,
    remainingSeconds: state.remainingSeconds,
    running: state.running,
    finished: state.finished,
    endsAt: state.endsAt,
    mainText: state.mainText,
    returnTime: state.returnTime,
    clockStyle: state.clockStyle,
    displayFont: state.displayFont,
    clockFont: state.clockFont,
    logoScale: state.logoScale,
    logoMotion: state.logoMotion,
    showSubtitle: state.showSubtitle,
    subtitleText: state.subtitleText,
    showContact: state.showContact,
    contactName: state.contactName,
    contactPhone: state.contactPhone,
    activePause: activePause ? {
      id: activePause.id,
      statusName: activePause.statusName,
      mode: activePause.mode,
      plannedMinutes: activePause.plannedMinutes,
      startedAt: activePause.startedAt,
      durationSeconds: getPauseDurationSeconds(activePause),
    } : null,
    updatedAt: state.updatedAt,
    displayUrl: base ? `${base}/display` : null,
    controlUrl: base ? `${base}/control` : null,
    localhostControlUrl: `http://localhost:${PORT}/control`,
    networkAddresses: getIPv4Addresses(),
  };
}

function broadcastState() {
  const payload = `data: ${JSON.stringify(createSnapshot())}\n\n`;
  for (const client of [...clients]) {
    try { client.write(payload); } catch { clients.delete(client); }
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function serveFile(res, filename) {
  const fp = path.join(ROOT, filename);
  const ct = CONTENT_TYPES[path.extname(filename)] || 'application/octet-stream';
  fs.readFile(fp, (err, buf) => {
    if (err) { sendJson(res, 404, { error: 'Not found.' }); return; }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) { req.destroy(); reject(new Error('Too large.')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function setMainMode(mode, reason = 'scene-change') {
  if (!VALID_MAIN_MODES.includes(mode)) throw new Error('Neplatný mód.');
  const active = getActivePauseEvent();

  if (mode === 'pause') {
    if (active && active.mode !== 'pause') {
      endPauseEvent(reason);
      state.showSubtitle = false;
    }
    state.mainMode = mode;
    if (!getActivePauseEvent()) startPauseEvent({ statusName: 'Pauza', mode: 'pause' });
  } else {
    if (active) {
      endPauseEvent(reason);
      state.showSubtitle = false;
    }
    state.mainMode = mode;
  }

  state.updatedAt = Date.now();
}

function activateKioskStatus(status) {
  endPauseEvent('status-change');
  state.mainMode = status.mode;
  state.running = false;
  state.finished = false;
  state.endsAt = null;

  if (status.mode === 'return') {
    state.returnTime = status.durationMinutes > 0
      ? getCzechTimePlusMinutes(status.durationMinutes)
      : state.returnTime;
  }

  if (status.mode === 'timer') {
    state.durationSeconds = status.durationMinutes * 60;
    state.remainingSeconds = state.durationSeconds;
    if (state.remainingSeconds > 0) {
      state.running = true;
      state.endsAt = Date.now() + state.remainingSeconds * 1000;
    }
  }

  if (status.mode === 'text') state.mainText = status.message;

  if (status.mode !== 'text') {
    state.subtitleText = status.message;
    state.showSubtitle = Boolean(status.message);
  }

  startPauseEvent({
    statusId: status.id,
    statusName: status.name,
    mode: status.mode,
    plannedMinutes: status.durationMinutes,
  });
  state.updatedAt = Date.now();
}

function endKioskPause() {
  endPauseEvent('ended');
  state.running = false;
  state.endsAt = null;
  state.mainMode = 'logo';
  state.showSubtitle = false;
  state.updatedAt = Date.now();
}

function createPauseAnalytics(days) {
  const safeDays = clampInt(days, 1, 90, 30);
  const now = Date.now();
  const from = now - safeDays * 24 * 60 * 60 * 1000;
  const events = pauseEvents
    .filter((event) => event.startedAt >= from)
    .map((event) => ({ ...event, durationSeconds: getPauseDurationSeconds(event, now) }));
  const totalSeconds = events.reduce((sum, event) => sum + event.durationSeconds, 0);
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, totalSeconds: 0 }));
  const byStatus = new Map();

  for (const event of events) {
    const hour = getCzechHour(event.startedAt);
    byHour[hour].count += 1;
    byHour[hour].totalSeconds += event.durationSeconds;
    const key = event.statusName || 'Pauza';
    const current = byStatus.get(key) || { name: key, count: 0, totalSeconds: 0 };
    current.count += 1;
    current.totalSeconds += event.durationSeconds;
    byStatus.set(key, current);
  }

  const activePause = getActivePauseEvent();
  return {
    days: safeDays,
    from,
    to: now,
    summary: {
      count: events.length,
      totalSeconds,
      averageSeconds: events.length ? Math.round(totalSeconds / events.length) : 0,
      activePause: activePause ? {
        statusName: activePause.statusName,
        startedAt: activePause.startedAt,
        durationSeconds: getPauseDurationSeconds(activePause, now),
      } : null,
    },
    byHour,
    byStatus: [...byStatus.values()].sort((a, b) => b.count - a.count),
    events: events.slice(0, 80),
  };
}

function handleAction(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Chybí payload.');

  switch (payload.type) {
    case 'set-main-mode':
      setMainMode(payload.mode);
      break;

    case 'set-duration': {
      const n = Math.max(0, Math.min(999, Math.round(Number(payload.minutes) || 0)));
      state.durationSeconds = n * 60;
      state.remainingSeconds = state.durationSeconds;
      state.running = false;
      state.finished = false;
      state.endsAt = null;
      state.updatedAt = Date.now();
      break;
    }

    case 'start-pause':
      if (state.running) {
        syncTimer();
        state.running = false;
        state.endsAt = null;
      } else {
        syncTimer();
        if (state.remainingSeconds <= 0) state.remainingSeconds = state.durationSeconds;
        if (state.remainingSeconds > 0) {
          state.running = true;
          state.finished = false;
          state.endsAt = Date.now() + state.remainingSeconds * 1000;
        }
      }
      state.updatedAt = Date.now();
      break;

    case 'reset':
      state.running = false;
      state.finished = false;
      state.endsAt = null;
      state.remainingSeconds = state.durationSeconds;
      state.updatedAt = Date.now();
      break;

    case 'set-main-text':
      state.mainText = String(payload.text || '').slice(0, 300);
      state.updatedAt = Date.now();
      break;

    case 'set-subtitle':
      if (payload.show !== undefined) state.showSubtitle = Boolean(payload.show);
      if (payload.text !== undefined) state.subtitleText = String(payload.text).slice(0, 200);
      state.updatedAt = Date.now();
      break;

    case 'set-return-time':
      state.returnTime = String(payload.time || '').trim().slice(0, 5);
      state.updatedAt = Date.now();
      break;

    case 'set-clock-style':
      if (!VALID_CLOCK_STYLES.includes(payload.style)) throw new Error('Neplatný styl hodin.');
      state.clockStyle = payload.style;
      state.updatedAt = Date.now();
      break;

    case 'set-display-font':
      if (!VALID_DISPLAY_FONTS.includes(payload.font)) throw new Error('Neplatné písmo výstupu.');
      state.displayFont = payload.font;
      state.updatedAt = Date.now();
      break;

    case 'set-clock-font':
      if (!VALID_DISPLAY_FONTS.includes(payload.font)) throw new Error('Neplatné písmo hodin.');
      state.clockFont = payload.font;
      state.updatedAt = Date.now();
      break;

    case 'set-logo-scale':
      state.logoScale = clampInt(payload.scale, 40, 180, state.logoScale);
      state.updatedAt = Date.now();
      break;

    case 'set-logo-motion':
      if (!VALID_LOGO_MOTIONS.includes(payload.motion)) throw new Error('Neplatný pohyb loga.');
      state.logoMotion = payload.motion;
      state.updatedAt = Date.now();
      break;

    case 'set-contact':
      if (payload.show !== undefined) state.showContact = Boolean(payload.show);
      if (payload.name !== undefined) state.contactName = String(payload.name).slice(0, 100);
      if (payload.phone !== undefined) state.contactPhone = String(payload.phone).slice(0, 30);
      state.updatedAt = Date.now();
      break;

    case 'save-template': {
      const name = String(payload.name || '').trim().slice(0, 80);
      if (!name) throw new Error('Název šablony je povinný.');
      templates.push({
        id: Date.now().toString(),
        name,
        mainMode: state.mainMode,
        durationMinutes: Math.round(state.durationSeconds / 60),
        mainText: state.mainText,
        returnTime: state.returnTime,
        clockStyle: state.clockStyle,
        displayFont: state.displayFont,
        clockFont: state.clockFont,
        logoScale: state.logoScale,
        logoMotion: state.logoMotion,
        showSubtitle: state.showSubtitle,
        subtitleText: state.subtitleText,
        showContact: state.showContact,
        contactName: state.contactName,
        contactPhone: state.contactPhone,
        createdAt: Date.now(),
      });
      saveTemplates();
      break;
    }

    case 'delete-template': {
      const idx = templates.findIndex((t) => t.id === String(payload.id));
      if (idx === -1) throw new Error('Šablona nenalezena.');
      templates.splice(idx, 1);
      saveTemplates();
      break;
    }

    case 'activate-template': {
      const tmpl = templates.find((t) => t.id === String(payload.id));
      if (!tmpl) throw new Error('Šablona nenalezena.');
      endPauseEvent('preset');
      state.mainMode = tmpl.mainMode;
      state.durationSeconds = (tmpl.durationMinutes || 0) * 60;
      state.remainingSeconds = state.durationSeconds;
      state.running = false;
      state.finished = false;
      state.endsAt = null;
      state.mainText = tmpl.mainText || '';
      state.returnTime = tmpl.returnTime || '';
      state.clockStyle = tmpl.clockStyle || 'digital';
      state.displayFont = VALID_DISPLAY_FONTS.includes(tmpl.displayFont) ? tmpl.displayFont : DEFAULT_STATE.displayFont;
      state.clockFont = VALID_DISPLAY_FONTS.includes(tmpl.clockFont) ? tmpl.clockFont : DEFAULT_STATE.clockFont;
      state.logoScale = clampInt(tmpl.logoScale, 40, 180, DEFAULT_STATE.logoScale);
      state.logoMotion = VALID_LOGO_MOTIONS.includes(tmpl.logoMotion) ? tmpl.logoMotion : DEFAULT_STATE.logoMotion;
      state.showSubtitle = Boolean(tmpl.showSubtitle);
      state.subtitleText = tmpl.subtitleText || '';
      state.showContact = Boolean(tmpl.showContact);
      state.contactName = tmpl.contactName || '';
      state.contactPhone = tmpl.contactPhone || '';
      state.updatedAt = Date.now();
      break;
    }

    case 'activate-kiosk-status': {
      const status = kioskStatuses.find((item) => item.id === String(payload.id));
      if (!status) throw new Error('Stav kiosku nenalezen.');
      activateKioskStatus(status);
      break;
    }

    case 'end-kiosk-pause':
      endKioskPause();
      break;

    case 'save-kiosk-status': {
      const id = payload.id ? String(payload.id) : '';
      const index = kioskStatuses.findIndex((item) => item.id === id);
      const existing = index >= 0 ? kioskStatuses[index] : {};
      const status = normalizeKioskStatus({ ...payload, id: id || undefined }, existing);
      if (!status.name) throw new Error('Název stavu je povinný.');
      if (index >= 0) kioskStatuses[index] = status;
      else kioskStatuses.push(status);
      saveKioskStatuses();
      break;
    }

    case 'delete-kiosk-status': {
      const index = kioskStatuses.findIndex((item) => item.id === String(payload.id));
      if (index === -1) throw new Error('Stav kiosku nenalezen.');
      kioskStatuses.splice(index, 1);
      saveKioskStatuses();
      break;
    }

    default:
      throw new Error(`Neznámá akce: ${payload.type}`);
  }
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`data: ${JSON.stringify(createSnapshot())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, createSnapshot());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/templates') {
    sendJson(res, 200, templates);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/kiosk-statuses') {
    sendJson(res, 200, kioskStatuses);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/pause-analytics') {
    sendJson(res, 200, createPauseAnalytics(url.searchParams.get('days')));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    handleEvents(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    const rel = path.normalize(url.pathname).replace(/^\/+/, '');
    if (!rel.startsWith('assets/')) {
      sendJson(res, 404, { error: 'Route nenalezena.' });
      return;
    }
    serveFile(res, rel);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    try {
      const raw = await readBody(req);
      const p = raw ? JSON.parse(raw) : {};
      handleAction(p);
      saveState();
      broadcastState();
      sendJson(res, 200, createSnapshot());
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Akce selhala.' });
    }
    return;
  }

  if (req.method === 'GET' && ROUTES.has(url.pathname)) {
    serveFile(res, ROUTES.get(url.pathname));
    return;
  }

  sendJson(res, 404, { error: 'Route nenalezena.' });
});

setInterval(() => {
  syncTimer();
  const key = `${state.mainMode}|${state.remainingSeconds}|${state.running}|${state.finished}|${state.mainText}|${state.returnTime}|${state.clockStyle}|${state.displayFont}|${state.clockFont}|${state.logoScale}|${state.logoMotion}|${state.showSubtitle}|${state.subtitleText}|${state.showContact}|${state.contactName}|${state.contactPhone}|${state.activePauseId || ''}`;
  if (key !== lastKey) {
    if (!state.running || state.mainMode !== 'timer' || state.finished || state.remainingSeconds === 0) saveState();
    lastKey = key;
    broadcastState();
  }
}, 250);

server.listen(PORT, HOST, () => {
  const addr = getPreferredAddress();
  console.log(`O2 Stánek – ovládání: http://localhost:${PORT}/control`);
  if (addr) console.log(`Display: http://${addr}:${PORT}/display`);
});

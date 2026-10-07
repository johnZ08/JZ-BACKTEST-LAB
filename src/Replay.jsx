import React, { useState, useEffect, useMemo, useRef } from 'react';

// Desfase en horas para alinear las velas de 1h/4h con tu broker (prueba 0, 1, 2, 3...)
const ALIGN_OFFSET_H = 0;

// Contrato que operas: MNQ = Micro E-mini Nasdaq-100, $2 por punto (tick de 0.25 = $0.50).
// Cambia el código cuando cambie el vencimiento (H=mar, M=jun, U=sep, Z=dic + último dígito del año).
const CONTRACT_SYMBOL = 'MNQZ6';
// URL del CSV maestro en Supabase Storage — se auto-carga para todos los visitantes
const CLOUD_CSV_URL = 'https://uwnjmqnznrkfxtvqujcf.supabase.co/storage/v1/object/public/datasets/nas100-master.csv';
const DEFAULT_POINT_VALUE = 2;
const ZOOM_STEPS = [30, 50, 100, 150, 250, 400]; // velas visibles según el zoom
const SPEEDS = [1, 2, 5, 10, 20]; // velas base por segundo
const TIMEFRAMES = [
  { sec: 30, label: '30s' },
  { sec: 60, label: '1m' },
  { sec: 120, label: '2m' },
  { sec: 180, label: '3m' },
  { sec: 300, label: '5m' },
  { sec: 900, label: '15m' },
  { sec: 1800, label: '30m' },
  { sec: 3600, label: '1h' },
  { sec: 14400, label: '4h' }
];

const fmtTime = (s) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ');
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => parseFloat(String(v).replace(',', '.'));

const toSeconds = (s) => {
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    return n > 1e11 ? Math.floor(n / 1000) : n;
  }
  const m = s.match(/(\d{4})[-./](\d{2})[-./](\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  return m
    ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000
    : NaN;
};

// Acepta encabezados: time | datetime | date (+ time), open, high, low, close (formato TradingView o MT5)
const parseCsv = (text) => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 3) throw new Error('El archivo no tiene suficientes filas.');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const hasQuotes = text.includes('"');
  const head = lines[0].split(sep).map((h) => h.replace(/[<>"]/g, '').trim().toLowerCase());
  const idx = (names) => head.findIndex((h) => names.includes(h));
  const iDate = idx(['date', 'datetime', 'time', 'timestamp', 'fecha']);
  const iTime = head.includes('date') ? idx(['time']) : -1;
  const iO = idx(['open', 'o']);
  const iH = idx(['high', 'h']);
  const iL = idx(['low', 'l']);
  const iC = idx(['close', 'c']);
  if ([iDate, iO, iH, iL, iC].some((i) => i < 0)) {
    throw new Error('Faltan columnas: time (o date + time), open, high, low, close.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = hasQuotes ? lines[i].split(sep).map((x) => x.replace(/"/g, '').trim()) : lines[i].split(sep);
    const t = toSeconds(iTime >= 0 ? `${p[iDate]} ${p[iTime]}` : p[iDate]);
    const o = num(p[iO]);
    const h = num(p[iH]);
    const l = num(p[iL]);
    const c = num(p[iC]);
    if ([t, o, h, l, c].every(Number.isFinite)) rows.push({ t, o, h, l, c });
  }
  rows.sort((a, b) => a.t - b.t);
  const clean = sanitizeRows(rows);
  if (clean.length < 2) throw new Error('No pude leer velas válidas en el archivo.');
  return clean;
};

// Una sola fila dañada (por ejemplo un mínimo en 0) estira la escala y aplasta todas las demás velas
const sanitizeRows = (rows) => {
  const out = [];
  for (const r of rows) {
    if (!(r.o > 0 && r.h > 0 && r.l > 0 && r.c > 0)) continue;
    out.push({ t: r.t, o: r.o, h: Math.max(r.h, r.o, r.c), l: Math.min(r.l, r.o, r.c), c: r.c });
  }
  return out;
};

const detectBase = (rows) => {
  const diffs = [];
  for (let i = 1; i < Math.min(rows.length, 500); i++) diffs.push(rows[i].t - rows[i - 1].t);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
};

// Datos simulados solo para probar el replay (NO sirven para evaluar estrategias).
// Imitan rasgos típicos del Nasdaq: volatilidad por hora (fuerte en la apertura de NY),
// rachas de volatilidad, tendencias cortas, colas gordas, gaps entre sesiones y tick de 0.25.
const genSample = () => {
  let seed = (Date.now() % 2147483646) + 1; // distinto en cada clic
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const tick = (x) => Math.round(x * 4) / 4;
  // volatilidad base (puntos por minuto) según la hora del archivo, leída como hora de Nueva York
  const baseVol = (h, m) => {
    const t = h + m / 60;
    if (t >= 9.5 && t < 11) return 2.8;
    if (t >= 14 && t < 16) return 2.0;
    if (t >= 11 && t < 14) return 1.4;
    if (t >= 8 && t < 9.5) return 1.3;
    if (t >= 3 && t < 8) return 1.0;
    if (t >= 16 && t < 17) return 0.9;
    return 0.6;
  };
  const out = [];
  let price = 30500;
  let trend = 0;
  let volMult = 1;
  const start = Date.UTC(2025, 0, 5, 18, 0) / 1000; // domingo 18:00
  for (let day = 0; day < 5; day++) {
    price += gauss() * 15; // gap entre sesiones
    for (let i = 0; i < 1380; i++) {
      const t = start + day * 86400 + i * 60;
      const d = new Date(t * 1000);
      const sigma = baseVol(d.getUTCHours(), d.getUTCMinutes()) * volMult;
      const shock = gauss() * (rnd() < 0.02 ? 3 : 1);
      trend = 0.97 * trend + gauss() * 0.04 * sigma;
      volMult = Math.min(3, 0.94 * volMult + 0.06 * (0.5 + Math.abs(shock) * 0.7));
      const o = tick(price);
      const c = tick(o + trend + sigma * shock);
      const h = tick(Math.max(o, c) + Math.abs(gauss()) * sigma * 0.5);
      const l = tick(Math.min(o, c) - Math.abs(gauss()) * sigma * 0.5);
      out.push({ t, o, h, l, c });
      price = c;
    }
  }
  return out;
};

// ---- Sesiones (killzones) ----
// Horas en Nueva York (ET: EST en invierno, EDT en verano). Edita este arreglo para cambiar rangos o colores.
// Un rango puede cruzar la medianoche (ej. 20:00 a 02:00). 'end' menor que 'start' implica el día siguiente.
const SESSIONS = [
  { id: 'asia', label: 'Asia', start: '20:00', end: '00:00', color: '#a855f7' },
  { id: 'london', label: 'Londres', start: '02:00', end: '05:00', color: '#f59e0b' },
  { id: 'ny', label: 'NY', start: '09:30', end: '16:00', color: '#3b82f6' }
];
const SESSION_ALPHA = 0.12; // opacidad del sombreado (10% a 15%)
const SERVER_OFFSET_H = 7; // servidor del CSV = hora de Nueva York + 7 h
const TZ_MODES = [
  { id: 'server7', label: 'CSV: servidor (NY + 7h)' },
  { id: 'utc', label: 'CSV: UTC' },
  { id: 'ny', label: 'CSV: hora de Nueva York' }
];

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Horario de verano de EE.UU.: del 2.º domingo de marzo (02:00 EST) al 1.er domingo de noviembre (02:00 EDT)
const nthSunday = (year, month, n) => {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
};
const isNyDst = (utcSec) => {
  const y = new Date(utcSec * 1000).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7) / 1000;
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6) / 1000;
  return utcSec >= start && utcSec < end;
};

// Hora del archivo -> "reloj de pared" de Nueva York (en segundos), y a la inversa
const fileToNy = (t, mode) =>
  mode === 'ny' ? t : mode === 'server7' ? t - SERVER_OFFSET_H * 3600 : t + (isNyDst(t) ? -4 : -5) * 3600;
const nyToFile = (w, mode) => {
  if (mode === 'ny') return w;
  if (mode === 'server7') return w + SERVER_OFFSET_H * 3600;
  const est = w + 5 * 3600;
  return isNyDst(est) ? w + 4 * 3600 : est;
};

// Todas las franjas de sesión que tocan el rango [tFrom, tTo], expresadas en la hora del archivo
const sessionIntervals = (tFrom, tTo, mode) => {
  const out = [];
  const d0 = Math.floor(fileToNy(tFrom, mode) / 86400) - 1;
  const d1 = Math.floor(fileToNy(tTo, mode) / 86400) + 1;
  for (let d = d0; d <= d1; d++) {
    SESSIONS.forEach((s) => {
      const a = toMin(s.start);
      let b = toMin(s.end);
      if (b <= a) b += 1440;
      out.push({ s, from: nyToFile(d * 86400 + a * 60, mode), to: nyToFile(d * 86400 + b * 60, mode) });
    });
  }
  return out;
};

const aggregate = (data, tf) => {
  const off = ALIGN_OFFSET_H * 3600;
  const out = [];
  data.forEach((c, i) => {
    const bucket = Math.floor((c.t + off) / tf) * tf - off;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.lastIdx = i;
    } else {
      out.push({ t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, firstIdx: i, lastIdx: i });
    }
  });
  return out;
};

// Último índice agregado cuya primera vela base ya se reprodujo
const findAggIndex = (agg, pos) => {
  let lo = 0;
  let hi = agg.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (agg[mid].firstIdx <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

// ---- Vista del gráfico: conversiones (tiempo, precio) <-> píxeles ----
// v = { lo, hi, left, cw, padY, padB, W, H, padR, candles, tf }
const viewTimeToX = (v, T) => {
  const c = v.candles;
  if (T <= c[0].t) return v.left;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid].t <= T) lo = mid;
    else hi = mid - 1;
  }
  return v.left + (lo + Math.min(1, (T - c[lo].t) / v.tf)) * v.cw;
};
const viewXToTime = (v, x) => {
  const idx = (x - v.left) / v.cw;
  const i = Math.max(0, Math.min(v.candles.length - 1, Math.floor(idx)));
  return v.candles[i].t + Math.max(0, Math.min(1, idx - i)) * v.tf;
};
const viewPriceToY = (v, p) => v.padY + ((v.hi - p) / (v.hi - v.lo)) * (v.H - v.padY - v.padB);
const viewYToPrice = (v, y) => v.hi - ((y - v.padY) / (v.H - v.padY - v.padB)) * (v.hi - v.lo);

// Dibujos anclados a (tiempo, precio): sobreviven al zoom, al desplazamiento y al cambio de temporalidad
const drawShape = (ctx, v, d, alpha = 1) => {
  const x1 = viewTimeToX(v, d.t1);
  const y1 = viewPriceToY(v, d.p1);
  const x2 = viewTimeToX(v, d.t2);
  const y2 = viewPriceToY(v, d.p2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, v.W - v.padR, v.H - v.padB);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1; // Trazo fino estilizado y proporcional a las velas
  if (d.type === 'line') {
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (d.type === 'rect') {
    ctx.fillStyle = hexToRgba('#facc15', 0.12);
    ctx.strokeStyle = '#facc15';
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else {
    // Fibonacci: niveles 0%, 50% (equilibrio, resaltado) y 100%
    const xa = Math.min(x1, x2);
    const xb = Math.max(x1, x2);
    const mid = (d.p1 + d.p2) / 2;
    const ym = viewPriceToY(v, mid);
    ctx.fillStyle = hexToRgba('#fb923c', 0.07);
    ctx.fillRect(xa, Math.min(y1, y2), xb - xa, Math.abs(y2 - y1));
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 1;
    [y1, y2].forEach((yy) => {
      ctx.beginPath();
      ctx.moveTo(xa, yy);
      ctx.lineTo(xb, yy);
      ctx.stroke();
    });
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(xa, ym);
    ctx.lineTo(xb, ym);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`50% ${mid.toFixed(2)}`, xa + 4, ym - 4);
  }
  ctx.restore();
};

const DOW_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const pad2 = (n) => String(n).padStart(2, '0');

// ---- Edición de dibujos: puntos de anclaje, selección y movimiento ----
const anchorsOf = (v, d) => {
  const x1 = viewTimeToX(v, d.t1);
  const y1 = viewPriceToY(v, d.p1);
  const x2 = viewTimeToX(v, d.t2);
  const y2 = viewPriceToY(v, d.p2);
  if (d.type === 'rect') {
    const xm = (x1 + x2) / 2;
    const ym = (y1 + y2) / 2;
    return {
      a: [x1, y1],
      b: [x2, y2],
      c: [x2, y1],
      d: [x1, y2],
      m_p1: [xm, y1],
      m_p2: [xm, y2],
      m_t1: [x1, ym],
      m_t2: [x2, ym]
    };
  }
  return { a: [x1, y1], b: [x2, y2] };
};
const isTouchDevice = () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

const hitHandle = (v, d, x, y) => {
  const an = anchorsOf(v, d);
  // En móviles damos 24px de radio para agarrar el extremo con el dedo; en PC dejamos 10px para precisión
  const radius = isTouchDevice() ? 24 : 10;
  return Object.keys(an).find((k) => Math.hypot(an[k][0] - x, an[k][1] - y) <= radius) || null;
};

const hitBody = (v, d, x, y) => {
  const { a, b } = anchorsOf(v, d);
  // Radio de tolerancia ampliado para tocar el trazo de la figura
  const tolerance = isTouchDevice() ? 18 : 7;
  if (d.type === 'line') {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const u = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
    return Math.hypot(x - (a[0] + u * dx), y - (a[1] + u * dy)) <= tolerance;
  }
  return (
    x >= Math.min(a[0], b[0]) - 4 && x <= Math.max(a[0], b[0]) + 4 &&
    y >= Math.min(a[1], b[1]) - 4 && y <= Math.max(a[1], b[1]) + 4
  );
};
// Mover un punto: en rectángulos, 'c' y 'd' son las esquinas que no se guardan directamente
const applyHandle = (d, handle, t, p) => {
  const n = { ...d };
  if (handle === 'a') { n.t1 = t; n.p1 = p; }
  else if (handle === 'b') { n.t2 = t; n.p2 = p; }
  else if (handle === 'c') { n.t2 = t; n.p1 = p; }
  else if (handle === 'd') { n.t1 = t; n.p2 = p; }
  else if (handle === 'm_p1') { n.p1 = p; }
  else if (handle === 'm_p2') { n.p2 = p; }
  else if (handle === 'm_t1') { n.t1 = t; }
  else if (handle === 'm_t2') { n.t2 = t; }
  return n;
};
const moveShape = (d, v, orig, dx, dy) => ({
  ...d,
  t1: viewXToTime(v, orig.a[0] + dx),
  p1: viewYToPrice(v, orig.a[1] + dy),
  t2: viewXToTime(v, orig.b[0] + dx),
  p2: viewYToPrice(v, orig.b[1] + dy)
});

// ---- Persistencia: el CSV (grande) va a IndexedDB; lo pequeño a localStorage ----
const STATE_KEY = 'jz_replay_state_v1';
const idbOpen = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('jz-backtest-lab', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const idbRun = async (mode, fn) => {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const idbGet = (key) => idbRun('readonly', (st) => st.get(key));
const idbSet = (key, val) => idbRun('readwrite', (st) => st.put(val, key));
const idbDel = (key) => idbRun('readwrite', (st) => st.delete(key));

// Velas en un Float64Array plano (t, o, h, l, c): ocupa y se copia mucho menos que miles de objetos
const packRows = (rows) => {
  const buf = new Float64Array(rows.length * 5);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = i * 5;
    buf[k] = r.t;
    buf[k + 1] = r.o;
    buf[k + 2] = r.h;
    buf[k + 3] = r.l;
    buf[k + 4] = r.c;
  }
  return buf;
};
const unpackRows = (buf) => {
  const n = buf.length / 5;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * 5;
    rows[i] = { t: buf[k], o: buf[k + 1], h: buf[k + 2], l: buf[k + 3], c: buf[k + 4] };
  }
  return rows;
};

const btn = 'px-3 py-1.5 rounded-lg border text-xs font-mono transition cursor-pointer';
const fieldClass =
  'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono transition';

export default function Replay({ onSave, savedTrades = [], active = true, onGoToRegistro, onRequestAuth }) {
  const [data, setData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [baseSec, setBaseSec] = useState(60);
  const [tf, setTf] = useState(60);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [slPts, setSlPts] = useState('20');
  const [tpPts, setTpPts] = useState('40');
  const [session, setSession] = useState('NY');
  const [contracts, setContracts] = useState('1');
  const [pointValue, setPointValue] = useState(String(DEFAULT_POINT_VALUE));
  const [commission, setCommission] = useState('0'); // $ por contrato, ida y vuelta
  const [dailyLimit, setDailyLimit] = useState('0'); // $ de pérdida diaria máxima (0 = sin límite)
  const [visible, setVisible] = useState(100);
  const [pan, setPan] = useState(0); // velas desplazadas hacia atrás
  const [yRange, setYRange] = useState(null); // FIX ETAPA 2: zoom manual del eje Y (null = auto-fit)
  const [showSessions, setShowSessions] = useState(true);
  const [tool, setTool] = useState('cursor'); // cursor | line | rect | fib
  const [drawings, setDrawings] = useState([]);
  const [ready, setReady] = useState(false); // true cuando terminó de restaurar lo guardado
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);// panel de órdenes (menú hamburguesa)
  const [panLock, setPanLock] = useState(false);
  const [angleLock, setAngleLock] = useState(false);
  const [axisLock, setAxisLock] = useState(false);
  const [priceColor, setPriceColor] = useState('#0ea5e9');
  const [priceOpacity, setPriceOpacity] = useState(1);
  const [bullColor, setBullColor] = useState('#10b981');
  const [bearColor, setBearColor] = useState('#f43f5e');
  const [sizeTick, setSizeTick] = useState(0);
  const [axisCsv, setAxisCsv] = useState(false); // eje de tiempo: hora NY (false) u hora tal cual del CSV (true)
  const [selectedId, setSelectedId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [tzMode, setTzMode] = useState('server7'); // zona horaria de las horas del CSV
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [position, setPosition] = useState(null);
    // 🎓 Challenge Simulator
  const [challengeStatus, setChallengeStatus] = useState('idle');
  const [challengeInitial, setChallengeInitial] = useState(25000);
  const [challengeBalance, setChallengeBalance] = useState(25000);
  const [challengePhase, setChallengePhase] = useState('eval');
  const [sessionTrades, setSessionTrades] = useState([]);
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const chartWrapRef = useRef(null);
  const viewRef = useRef(null);
  const draftRef = useRef(null);
  const hoverRef = useRef(null);
  const lastSaveRef = useRef(0);
  const drawingsRef = useRef([]);
  const selectedRef = useRef(null);
  const dragRef = useRef(null);
  const axisDragRef = useRef(null); // FIX ETAPA 2: arrastre sobre los ejes para hacer zoom
  const freePanRef = useRef(null);
  drawingsRef.current = drawings;
  const stepRef = useRef();
    // FIX: bloquea el scroll de la página en móvil mientras Replay está montado
    // HiDPI / Retina Fix: sincroniza el bitmap con el devicePixelRatio real de la pantalla
  useEffect(() => {
    const wrap = chartWrapRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !canvas || !overlay) return undefined;

    const update = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3)); // límite óptimo de 3 para no saturar memoria en móviles
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        overlay.width = w;
        overlay.height = h;
        setSizeTick((t) => t + 1);
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined') return undefined;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (!isMobile) return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.width = '';
    };
  }, [active]);

  const allowed = useMemo(
    () => TIMEFRAMES.filter((x) => x.sec >= baseSec && x.sec % baseSec === 0),
    [baseSec]
  );
  const agg = useMemo(() => (data.length ? aggregate(data, tf) : []), [data, tf]);
  const tfLabel = TIMEFRAMES.find((x) => x.sec === tf)?.label || `${tf}s`;

  const visibleCandles = useMemo(() => {
    if (!agg.length) return [];
    const i = findAggIndex(agg, pos);
    // FIX PANEO: deja retroceder casi hasta el inicio del histórico (solo visible velas mínimas en pantalla)
    const maxPan = Math.max(0, i - Math.floor(visible * 0.5));
    const end = Math.max(0, i - Math.min(pan, maxPan));
    const list = agg.slice(Math.max(0, end - visible + 1), end + 1);
    const cur = list[list.length - 1];
    if (end === i && cur.lastIdx > pos) {
      // vela en formación: se arma solo con datos ya reproducidos
      let h = -Infinity;
      let l = Infinity;
      for (let k = cur.firstIdx; k <= pos; k++) {
        h = Math.max(h, data[k].h);
        l = Math.min(l, data[k].l);
      }
      list[list.length - 1] = { ...cur, h, l, c: data[pos].c };
    }
    return list;
  }, [agg, pos, data, visible, pan]);

  const loadData = (rows, name, tz = 'server7') => {
    const base = detectBase(rows);
    const ok = TIMEFRAMES.filter((x) => x.sec >= base && x.sec % base === 0);
    if (!ok.length) {
      setError(`Temporalidad base no soportada (${base}s). Usa datos de 30s, 1m o más.`);
      return;
    }
    setData(rows);
    setFileName(name);
    setBaseSec(base);
    setTf(ok[0].sec);
    setPos(Math.min(rows.length - 1, 300));
    setPan(0);
    setYRange(null); // FIX ETAPA 2: reset del zoom manual en Y al cargar datos nuevos
    setTzMode(tz);
    setPosition(null);
    setSessionTrades([]);
    setPlaying(false);
    setError('');
    setDrawings([]);
    idbSet('data', { name, buf: packRows(rows) })
      .then(() => navigator.storage?.persist?.())
      .catch(() => setError('No se pudo guardar el CSV en el navegador (¿poco espacio?).'));
  };
    // 🎓 Challenge: inicia un challenge aleatorio desde una posición al azar
  const startChallenge = () => {
    if (!data.length) {
      setError('Primero carga un CSV para iniciar el Challenge.');
      return;
    }
    if (position) {
      setError('Cierra la operación abierta antes de iniciar un Challenge.');
      return;
    }

    // Salto aleatorio: mínimo 300 velas de contexto inicial,
    // dejando al menos 500 velas para operar cómodamente
    const MIN_START = 300;
    const MIN_REMAINING = 500;
    const maxStart = Math.max(MIN_START + 1, data.length - MIN_REMAINING);
    const randomPos = MIN_START + Math.floor(Math.random() * (maxStart - MIN_START));

    setPos(randomPos);
    setPan(0);
    setYRange(null);
    setChallengeBalance(challengeInitial);
    setChallengeStatus('running');
    setError('');
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 30)); // deja pintar el aviso antes de procesar
    try {
      loadData(parseCsv(await file.text()), file.name);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const closePosition = (outcome, r, exitIdx) => {
    const p = position;
    const risk = p.risk; // riesgo inicial en puntos (no cambia aunque muevas el SL)
    const rr = round2(p.rr0);
    const day = new Date(p.openTime * 1000).toISOString().slice(0, 10);
    const [y, m, d] = day.split('-');
    setSessionTrades((prev) => [
      ...prev,
      {
        id: Date.now() + prev.length,
        dateISO: day,
        date: `${d}/${m}/${y}`,
        monthKey: `${y}-${m}`,
        asset: CONTRACT_SYMBOL,
        type: p.type,
        outcome,
        entry: p.entry,
        sl: p.sl,
        tp: p.tp,
        rr,
        resultR: round2(r),
        contracts: p.contracts,
        pointValue: p.pointValue,
        commissionUSD: round2(p.commission * p.contracts),
        pnlUSD: round2(r * risk * p.pointValue * p.contracts - p.commission * p.contracts),
        session: p.session,
        notes: `Replay ${tfLabel} - cierre ${fmtTime(data[exitIdx].t)}`
      }
    ]);
    setPosition(null);
  };

  // Se reasigna en cada render para que el intervalo siempre use el estado actual
  stepRef.current = (n) => {
    if (!data.length || pos >= data.length - 1) {
      setPlaying(false);
      return;
    }
    let p = pos;
    for (let k = 0; k < n && p < data.length - 1; k++) {
      p++;
      if (position) {
        const c = data[p];
        const slHit = position.type === 'BUY' ? c.l <= position.sl : c.h >= position.sl;
        const tpHit = position.type === 'BUY' ? c.h >= position.tp : c.l <= position.tp;
        if (slHit || tpHit) {
          // si ambos caen en la misma vela se asume SL primero (criterio conservador)
          const dir = position.type === 'BUY' ? 1 : -1;
          const exit = slHit ? position.sl : position.tp;
          const r = (dir * (exit - position.entry)) / position.risk;
          closePosition(r > 0 ? 'WIN' : r < 0 ? 'LOSS' : 'BE', r, p);
          setPos(p);
          setPlaying(false);
          return;
        }
      }
    }
    setPos(p);
    if (p >= data.length - 1) setPlaying(false);
  };

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => stepRef.current(1), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  // al abrir una operación, los campos de "Nuevo SL/TP" arrancan con sus niveles
  useEffect(() => {
    if (position) {
      setEditSl(String(position.sl));
      setEditTp(String(position.tp));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.openTime]);

  const nextCandle = () => {
    if (!agg.length) return;
    const i = findAggIndex(agg, pos);
    const target = agg[i].lastIdx > pos ? agg[i].lastIdx : agg[Math.min(i + 1, agg.length - 1)].lastIdx;
    stepRef.current(target - pos);
  };

  const openPosition = (type) => {
    if (limitHit) {
      setError('Límite de pérdida diaria alcanzado: sin nuevas entradas hoy.');
      return;
    }
    const sl = Number(slPts);
    const tp = Number(tpPts);
    if (!(sl > 0 && tp > 0)) {
      setError('SL y TP (en puntos) deben ser mayores que 0.');
      return;
    }
    const price = data[pos].c;
    setPosition({
      type,
      entry: round2(price),
      sl: round2(type === 'BUY' ? price - sl : price + sl),
      tp: round2(type === 'BUY' ? price + tp : price - tp),
      openTime: data[pos].t,
      session,
      contracts: Math.max(1, Math.floor(Number(contracts)) || 1),
      pointValue: Number(pointValue) || DEFAULT_POINT_VALUE,
      commission: Math.max(0, Number(commission) || 0),
      risk: sl,
      rr0: tp / sl
    });
    setError('');
  };

  const floatR = position
    ? ((position.type === 'BUY' ? 1 : -1) * (data[pos].c - position.entry)) /
      position.risk
    : 0;

  const floatPts = position ? (position.type === 'BUY' ? 1 : -1) * (data[pos].c - position.entry) : 0;
  const floatUSD = position
    ? floatPts * position.pointValue * position.contracts - position.commission * position.contracts
    : 0;
  const nContracts = Math.max(0, Math.floor(Number(contracts)) || 0);
  const commissionTotal = (Number(commission) || 0) * nContracts;
  const riskUSD = (Number(slPts) || 0) * (Number(pointValue) || 0) * nContracts + commissionTotal;
  const rewardUSD = (Number(tpPts) || 0) * (Number(pointValue) || 0) * nContracts - commissionTotal;

  const currentDay = data.length ? new Date(data[pos].t * 1000).toISOString().slice(0, 10) : '';
  const dailyPnL = [...savedTrades, ...sessionTrades]
    .filter((t) => t.dateISO === currentDay)
    .reduce((acc, t) => acc + (t.pnlUSD || 0), 0);
  const limitHit = Number(dailyLimit) > 0 && dailyPnL <= -Number(dailyLimit);
        // --- REGLA DEL 40%: Concentración del Beneficio (SEGURA) ---
  const allTrades = [...savedTrades, ...sessionTrades];
  
  // Intentamos obtener el profit target de varias fuentes posibles
  let totalProfitTarget = 1500; // Valor por defecto
  if (typeof challengeConfig !== 'undefined' && challengeConfig) {
    if (challengeConfig.profitTarget) {
      totalProfitTarget = Number(challengeConfig.profitTarget) || 1500;
    } else if (challengeConfig.target) {
      totalProfitTarget = Number(challengeConfig.target) || 1500;
    }
  }
  
  const sumWinningTrades = allTrades
    .filter(t => t.result === 'WIN')
    .reduce((acc, t) => acc + Math.max(0, t.pnlUSD || 0), 0);
  
  const profitPercentage = totalProfitTarget > 0 ? (sumWinningTrades / totalProfitTarget) * 100 : 0;
  const isAbove40PercentProfit = profitPercentage > 40;
 
   const applyLevels = () => {
    const c = data[pos].c;
    const newSl = parseFloat(editSl);
    const newTp = parseFloat(editTp);
    const ok =
      position.type === 'BUY' ? newSl < c && newTp > c : newSl > c && newTp < c;
    if (!Number.isFinite(newSl) || !Number.isFinite(newTp) || !ok) {
      setError('El SL y el TP deben quedar a cada lado del precio actual.');
      return;
    }
    setPosition({ ...position, sl: round2(newSl), tp: round2(newTp) });
    setError('');
  };

    const moveToBreakEven = () => {
    const c = data[pos].c;
    const inProfit = position.type === 'BUY' ? c > position.entry : c < position.entry;
    if (!inProfit) {
      setError('Solo puedes llevar a break-even con la operación en ganancia.');
      return;
    }
    setPosition({ ...position, sl: position.entry });
    setEditSl(String(position.entry));
    setError('');
  };

  const closeAtMarket = () => {
    const r = round2(floatR);
    closePosition(r > 0 ? 'WIN' : r < 0 ? 'LOSS' : 'BE', r, pos);
  };

    const handleClearSession = () => {
    if (sessionTrades.length === 0) {
      setError('No hay trades de sesión para vaciar.');
      return;
    }
    if (window.confirm(`¿Seguro que quieres vaciar ${sessionTrades.length} trades no guardados? Esta acción no se puede deshacer.`)) {
      setSessionTrades([]);
      setError('');
      // Opcional: Si quieres limpiar también la posición abierta actual
      setPosition(null);
    }
  };
  const handleSave = () => {
    onSave(sessionTrades, () => setSessionTrades([])); // se vacía solo si autorizas con el PIN
  };

  // Capa estática del gráfico: sesiones, ejes, velas, dibujos y posición
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || visibleCandles.length === 0) return;
   const ctx = cv.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // HiDPI Crisp Rendering: desactiva suavizado borroso para líneas vectoriales y mechas
    ctx.imageSmoothingEnabled = false;
    const W = cv.width / dpr;
    const H = cv.height / dpr;
    const padR = 84;
    const padY = 16;
    const padB = 42;
    const plotW = W - padR;
    const plotH = H - padB;
    ctx.clearRect(0, 0, W, H);

    const vc = visibleCandles;
    let lo = Math.min(...vc.map((c) => c.l));
    let hi = Math.max(...vc.map((c) => c.h));
    if (position) {
      lo = Math.min(lo, position.sl, position.tp);
      hi = Math.max(hi, position.sl, position.tp);
    }
    const minSpan = ((hi + lo) / 2) * 0.0015; // ~0,15% del precio (unos 45 puntos en el Nasdaq)
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    // FIX ETAPA 2: si el usuario hizo zoom manual en Y, se respeta ese rango
    if (yRange) {
      lo = yRange.lo;
      hi = yRange.hi;
    } else {
      const margin = (hi - lo || 1) * 0.06;
      lo -= margin;
      hi += margin;
    };
    const cw = plotW / visible;
    const left = (visible - vc.length) * cw;
    const v = { lo, hi, left, cw, padY, padB, W, H, padR, candles: vc, tf };
    viewRef.current = v;
    const y = (p) => viewPriceToY(v, p);

              // 1) Sesiones: sombreado + líneas de high/low + apertura de NY
    const marks = [];
    if (showSessions) {
      const tFrom = vc[0].t;
      const tTo = vc[vc.length - 1].t + tf;
      sessionIntervals(tFrom, tTo, tzMode).forEach(({ s: ses, from, to }) => {
        if (to <= tFrom || from >= tTo) return;
        const x1 = Math.max(left, viewTimeToX(v, from));
        const x2 = Math.min(plotW, viewTimeToX(v, to));
        if (x2 - x1 < 1) return;

        // Rango high/low de las velas dentro de la sesión
        let sLo = Infinity;
        let sHi = -Infinity;
        for (const c of vc) {
          if (c.t + tf > from && c.t < to) {
            if (c.l < sLo) sLo = c.l;
            if (c.h > sHi) sHi = c.h;
          }
        }

        if (sLo !== Infinity && sHi !== -Infinity) {
          const yHi = y(sHi);
          const yLo = y(sLo);
          const vPad = 8; // margen vertical para que el rectángulo respire
          const top = Math.max(0, yHi - vPad);
          const bot = Math.min(plotH, yLo + vPad);

          // Sombreado del rango
          ctx.fillStyle = hexToRgba(ses.color, SESSION_ALPHA);
          ctx.fillRect(x1, top, x2 - x1, bot - top);

          // FIX: líneas de high y low que solo abarcan el ancho de la sesión
          ctx.strokeStyle = hexToRgba(ses.color, 0.85);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x1, yHi);
          ctx.lineTo(x2, yHi);
          ctx.moveTo(x1, yLo);
          ctx.lineTo(x2, yLo);
          ctx.stroke();

          // Etiqueta de la sesión arriba del rango, si hay espacio
          if (x2 - x1 > 46) {
            ctx.font = '10px monospace';
            ctx.fillStyle = hexToRgba(ses.color, 0.9);
            ctx.fillText(ses.label, x1 + 4, Math.max(12, top - 4));
          }
        }

        if (from >= tFrom) {
          marks.push({ s: ses, x: x1 });
          if (ses.id === 'ny') {
            ctx.strokeStyle = hexToRgba(ses.color, 0.6);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x1, 0);
            ctx.lineTo(x1, plotH);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      });
    }

    // 2) Cuadrícula y escala de precios con pasos "redondos"
    ctx.lineWidth = 1;
    const isWide = cv.clientWidth > 700;
    ctx.font = `${isWide ? 11 : 7}px monospace`;
    const rawStep = (hi - lo) / 6;
    const mag = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= rawStep);
    for (let p = Math.ceil(lo / step) * step, n = 0; p <= hi && n < 20; p += step, n++) {
      ctx.strokeStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(0, y(p));
      ctx.lineTo(plotW, y(p));
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(p.toFixed(step < 1 ? 2 : 1), plotW + 6, y(p) + 4);
    }

    // 3) Velas
    vc.forEach((c, i) => {
      const x = left + i * cw + cw / 2;
      const color = c.c >= c.o ? bullColor : bearColor;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.stroke();
      ctx.fillRect(x - cw * 0.35, y(Math.max(c.o, c.c)), cw * 0.7, Math.max(1, Math.abs(y(c.o) - y(c.c))));
    });

    // 4) Dibujos del usuario
    drawings.forEach((d) => {
      if (d.id !== draggingId) drawShape(ctx, v, d);
    });

    // 5) Posición abierta y precio actual
    const hline = (p, color, label) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y(p));
      ctx.lineTo(plotW, y(p));
      ctx.stroke();
      ctx.setLineDash([]);
      if (label) ctx.fillText(`${label} ${p.toFixed(1)}`, plotW + 6, y(p) - 3);
    };
    if (position) {
      hline(position.entry, '#94a3b8', 'E');
      hline(position.sl, '#f43f5e', 'SL');
      hline(position.tp, '#10b981', 'TP');
      const up = floatUSD >= 0;
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = up ? '#10b981' : '#f43f5e';
      ctx.fillText(
        `${up ? '+' : ''}${floatPts.toFixed(2)} pts   ${up ? '+' : '-'}$${Math.abs(floatUSD).toFixed(2)}`,
        10,
        22
      );
    }
    const lastC = vc[vc.length - 1].c;
    hline(lastC, priceColor, '');
    // FIX: recuadro de precio adaptativo (más chico en móvil) y personalizable
    const boxH = isWide ? 18 : 13;
    const boxFont = isWide ? 'bold 11px monospace' : 'bold 9px monospace';
    const boxY = y(lastC) - boxH / 2;
    ctx.globalAlpha = priceOpacity;
    ctx.fillStyle = priceColor;
    ctx.fillRect(plotW + 2, boxY, padR - 4, boxH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#020617';
    ctx.font = boxFont;
    ctx.textBaseline = 'middle';
    ctx.fillText(lastC.toFixed(2), plotW + 6, y(lastC));
    ctx.textBaseline = 'alphabetic';

    // 6) Eje de tiempo: hora y fecha (hora de NY convertida, o la hora tal cual viene en el CSV)
    const wallOf = (t) => (axisCsv ? t : fileToNy(t, tzMode));
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, plotH);
    ctx.lineTo(plotW, plotH);
    ctx.stroke();
    const minPerCandle = tf / 60;
    const interval = [1, 5, 15, 30, 60, 120, 240, 360, 720, 1440].find((m) => (m / minPerCandle) * cw >= 70) || 1440;
    ctx.font = `${isWide ? 10 : 6}px monospace`;
    let prevBucket = null;
    let prevDay = null;
    let dateShown = false;
    vc.forEach((c, i) => {
      const wall = wallOf(c.t);
      const bucket = Math.floor(wall / (interval * 60));
      const day = Math.floor(wall / 86400);
      if (prevBucket !== null && (bucket !== prevBucket || day !== prevDay)) {
        const x = left + i * cw;
        const d = new Date(wall * 1000);
        const dateStr = `${DOW_ES[d.getUTCDay()]} ${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
        const showDate = day !== prevDay || !dateShown; // siempre hay una fecha de referencia visible
        dateShown = true;
        ctx.beginPath();
        ctx.moveTo(x, plotH);
        ctx.lineTo(x, plotH + 4);
        ctx.stroke();
        ctx.fillStyle = showDate ? '#e2e8f0' : '#94a3b8';
        if (interval >= 1440) {
          ctx.fillText(dateStr, x - 14, plotH + 14);
        } else {
          ctx.fillText(`${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`, x - 14, plotH + 13);
          if (showDate) {
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(dateStr, x - 14, plotH + 24);
          }
        }
      }
      prevBucket = bucket;
      prevDay = day;
    });
    ctx.font = 'bold 9px monospace';
    marks.forEach(({ s: ses, x }) => {
      ctx.fillStyle = ses.color;
      ctx.fillRect(x - 1, plotH, 2, 8);
      ctx.fillText(`${ses.label} ${ses.start}`, Math.min(x + 3, plotW - 70), H - 4);
    });
  },  [visibleCandles, position, floatPts, floatUSD, visible, showSessions, tzMode, tf, drawings, draggingId, axisCsv, yRange, sizeTick, priceColor, priceOpacity, bullColor, bearColor, active]);
  // Capa interactiva (cruz, dibujo en curso, edición): se pinta sin re-renderizar React
  const drawOverlay = () => {
    const cv = overlayRef.current;
    const v = viewRef.current;
    if (!cv || !v) return;
    const ctx = cv.getContext('2d');
   const dpr = cv.width / cv.clientWidth;
    if (!isFinite(dpr) || dpr <= 0 || cv.clientWidth === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
    const h = hoverRef.current;
    if (h) {
      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(h.x, 0);
      ctx.lineTo(h.x, v.H - v.padB);
      ctx.moveTo(0, h.y);
      ctx.lineTo(v.W - v.padR, h.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#334155';
      ctx.fillRect(v.W - v.padR + 2, h.y - 9, v.padR - 4, 18);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(viewYToPrice(v, h.y).toFixed(2), v.W - v.padR + 6, h.y + 4);
      const tt = viewXToTime(v, h.x);
      const dd = new Date((axisCsv ? tt : fileToNy(tt, tzMode)) * 1000);
      const label = `${DOW_ES[dd.getUTCDay()]} ${pad2(dd.getUTCDate())}/${pad2(dd.getUTCMonth() + 1)} ${pad2(dd.getUTCHours())}:${pad2(dd.getUTCMinutes())}`;
      const lx = Math.max(58, Math.min(v.W - v.padR - 58, h.x));
      ctx.fillStyle = '#334155';
      ctx.fillRect(lx - 56, v.H - v.padB + 2, 112, 16);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(label, lx - 50, v.H - v.padB + 14);
    }
    if (draftRef.current) drawShape(ctx, v, draftRef.current, 0.9);
    const g = dragRef.current;
    if (g) drawShape(ctx, v, g.shape);
       const sel = g ? g.shape : drawingsRef.current.find((d) => d.id === selectedRef.current);
    if (sel) {
      const entries = Object.entries(anchorsOf(v, sel));
      entries.forEach(([key, [x, y]]) => {
        const isMid = key.startsWith('m_');
        // Manijas más sutiles y proporcionadas con las velas
        const r = isMid ? 2 : 2.5;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = isMid ? '#64748b' : '#38bdf8'; // Borde celeste sutil para ubicar rápido el punto
        ctx.lineWidth = 1; // Trazo fino estético
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  };

  // Lista de dibujos con espejo síncrono (ref) para que la capa interactiva nunca lea datos viejos
  const updateDrawings = (fn) => {
    const next = fn(drawingsRef.current);
    drawingsRef.current = next;
    setDrawings(next);
  };
  const select = (id) => {
    selectedRef.current = id;
    setSelectedId(id);
  };
  const deleteSelected = () => {
    const id = selectedRef.current;
    if (!id) return;
    updateDrawings((prev) => prev.filter((d) => d.id !== id));
    select(null);
    drawOverlay();
  };

const eventPoint = (e) => {
    const cv = overlayRef.current;
    if (!cv) return { x: 0, y: 0 };
    const r = cv.getBoundingClientRect();
    const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
    
    // Coordenadas CSS exactas correspondientes al sistema de coordenadas de la vista
    return {
      x: clientX - r.left,
      y: clientY - r.top
    };
  };
const onPointerDown = (e) => {
    const v = viewRef.current;
    if (!v) return;
    e.currentTarget.focus();
    const { x, y } = eventPoint(e);
    hoverRef.current = { x, y };

    // FIX ETAPA 2: arrastrar sobre el eje de precio (derecha) o el de tiempo (abajo) hace zoom si no está bloqueado
    // Margen táctil ampliado (pad + 10px) para facilitar tocar los ejes en pantallas táctiles
    const onPriceAxis = !axisLock && x >= (v.W - v.padR - 10);
    const onTimeAxis = !axisLock && y >= (v.H - v.padB - 10);

    if (onPriceAxis || onTimeAxis) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
      axisDragRef.current = {
        kind: onPriceAxis ? 'y' : 'x',
        startX: x,
        startY: y,
        startVisible: visible,
        startRange: yRange ?? { lo: v.lo, hi: v.hi }
      };
      return;
    }

    // Para dibujo, crosshair o paneo libre en el gráfico
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    // FIX PANEO LIBRE: arrastrar dentro del canvas mueve las velas (si el candado está abierto)
    if (tool === 'cursor' && !panLock && (axisLock || (x <= v.W - v.padR && y <= v.H - v.padB))) {
      const list = drawingsRef.current;
      const cur = list.find((d) => d.id === selectedRef.current);
      const overDrawing =
        (cur && hitHandle(v, cur, x, y)) ||
        list.some((d) => hitBody(v, d, x, y));
      if (!overDrawing) {
        e.currentTarget.setPointerCapture(e.pointerId);
        freePanRef.current = {
          startX: x,
          startY: y,
          startPan: pan,
          startYRange: yRange ?? { lo: v.lo, hi: v.hi },
          cw: v.cw
        };
        return;
      }
    }
    if (tool !== 'cursor') {
      // crear un dibujo nuevo
      if (x > v.W - v.padR || y > v.H - v.padB) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const t = viewXToTime(v, x);
      const p = viewYToPrice(v, y);
      draftRef.current = { type: tool, t1: t, p1: p, t2: t, p2: p };
    } else {
      // seleccionar y editar: primero los puntos del dibujo seleccionado, luego el cuerpo (el de arriba gana)
      const list = drawingsRef.current;
      const cur = list.find((d) => d.id === selectedRef.current);
      const handle = cur ? hitHandle(v, cur, x, y) : null;
      let target = handle ? cur : null;
      if (!target) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (hitBody(v, list[i], x, y)) {
            target = list[i];
            break;
          }
        }
      }
      if (!target) {
        select(null);
      } else {
        select(target.id);
        setPlaying(false);
        setDraggingId(target.id);
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
          id: target.id,
          kind: handle ? 'handle' : 'move',
          handle,
          start: { x, y },
          orig: anchorsOf(v, target),
          base: target,
          shape: target
        };
      }
    }
    drawOverlay();
  };
    const onPointerMove = (e) => {
    const v = viewRef.current;
    if (!v) return;
    const { x, y } = eventPoint(e);
    hoverRef.current = { x, y };
    const g = dragRef.current;

    // FIX PANEO LIBRE: si estás arrastrando el canvas, mueve las velas
    if (freePanRef.current) {
      const a = freePanRef.current;
      const dx = x - a.startX;
      const dy = y - a.startY;
      const candleShift = Math.round(dx / a.cw);
      if (candleShift !== 0) setPan(Math.max(0, a.startPan + candleShift));
      const pricePerPx = (a.startYRange.hi - a.startYRange.lo) / (v.H - v.padY - v.padB);
      const shift = dy * pricePerPx;
      setYRange({ lo: a.startYRange.lo + shift, hi: a.startYRange.hi + shift });
      drawOverlay();
      return;
    }

    // FIX ETAPA 2: si estás arrastrando un eje, se hace zoom y se omite el resto
    if (axisDragRef.current) {
      const a = axisDragRef.current;
      if (a.kind === 'x') {
        const factor = Math.exp((x - a.startX) / 35);
        const nv = Math.max(20, Math.min(1500, Math.round(a.startVisible / factor)));
        a.pendingVisible = nv;
        if (!a.raf) {
          a.raf = requestAnimationFrame(() => {
            if (a.pendingVisible !== undefined) setVisible(a.pendingVisible);
            a.raf = null;
          });
        }
      } else {
        const factor = Math.exp((y - a.startY) / 15);
        const { lo, hi } = a.startRange;
        const center = (lo + hi) / 2;
        const half = ((hi - lo) / 2) * factor;
        a.pendingYRange = { lo: center - half, hi: center + half };
        if (!a.raf) {
          a.raf = requestAnimationFrame(() => {
            if (a.pendingYRange) setYRange(a.pendingYRange);
            a.raf = null;
          });
        }
      }
      drawOverlay();
      return;
    }

    if (draftRef.current) {
      let t2 = viewXToTime(v, x);
      let p2 = viewYToPrice(v, y);
      // FIX ETAPA 1: Shift = snap a múltiplos de 45° (0°, 45°, 90°, ...)
      if (e.shiftKey || angleLock) {
        const d = draftRef.current;
        const x1 = viewTimeToX(v, d.t1);
        const y1 = viewPriceToY(v, d.p1);
        const dx = x - x1;
        const dy = y - y1;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const angle = Math.atan2(dy, dx);
          const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const sx = x1 + Math.cos(snapped) * len;
          const sy = y1 + Math.sin(snapped) * len;
          t2 = viewXToTime(v, sx);
          p2 = viewYToPrice(v, sy);
        }
      }
      draftRef.current.t2 = t2;
      draftRef.current.p2 = p2;
       } else if (g) {
      if (g.kind === 'handle' && (e.shiftKey || angleLock) && g.base.type === 'line') {
        // Snap al alargar una línea: usa el extremo opuesto como pivote
        const an = anchorsOf(v, g.base);
        const pivot = g.handle === 'a' ? an.b : an.a;
        const dx = x - pivot[0];
        const dy = y - pivot[1];
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const angle = Math.atan2(dy, dx);
          const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const sx = pivot[0] + Math.cos(snapped) * len;
          const sy = pivot[1] + Math.sin(snapped) * len;
          g.shape = applyHandle(g.base, g.handle, viewXToTime(v, sx), viewYToPrice(v, sy));
        } else {
          g.shape = applyHandle(g.base, g.handle, viewXToTime(v, x), viewYToPrice(v, y));
        }
      } else {
        g.shape =
          g.kind === 'handle'
            ? applyHandle(g.base, g.handle, viewXToTime(v, x), viewYToPrice(v, y))
            : moveShape(g.base, v, g.orig, x - g.start.x, y - g.start.y);
      }
    } else if (tool === 'cursor') {
      const list = drawingsRef.current;
      const cur = list.find((d) => d.id === selectedRef.current);
      overlayRef.current.style.cursor =
        cur && hitHandle(v, cur, x, y) ? 'pointer' : list.some((d) => hitBody(v, d, x, y)) ? 'move' : 'default';
    }
    drawOverlay();
  };
  const onPointerUp = (e) => {
    try {
      if (e?.pointerId && e.currentTarget?.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
    const d = draftRef.current;
    const g = dragRef.current;
    draftRef.current = null;
    dragRef.current = null;
    freePanRef.current = null; // FIX PANEO LIBRE: fin del paneo
    if (axisDragRef.current?.raf) cancelAnimationFrame(axisDragRef.current.raf);
    axisDragRef.current = null; // FIX ETAPA 2: fin del arrastre de eje
    if (d && (d.t1 !== d.t2 || d.p1 !== d.p2)) {
      const nd = { ...d, id: Date.now() };
      updateDrawings((prev) => [...prev, nd]);
      select(nd.id);
      setTool('cursor'); // al terminar un trazo vuelves al cursor para poder editarlo
    } else if (g) {
      updateDrawings((prev) => prev.map((x) => (x.id === g.id ? g.shape : x)));
      setDraggingId(null);
    }
    drawOverlay();
  };
   const onPointerLeave = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      // En móvil, al soltar el dedo el crosshair se queda (comportamiento TradingView)
      drawOverlay();
      return;
    }
    hoverRef.current = null;
    drawOverlay();
  };
  const onKeyDown = (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'Escape') {
      draftRef.current = null;
      select(null);
      setTool('cursor');
      drawOverlay();
    }
  };
  const count = (type) => drawings.filter((d) => d.type === type).length;

  // Restaurar al abrir: CSV desde IndexedDB y el resto desde localStorage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await idbGet('data');
        const st = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        if (cancelled) return;
        if (saved?.buf) {
          const rows = sanitizeRows(unpackRows(saved.buf));
          const base = detectBase(rows);
          const ok = TIMEFRAMES.filter((x) => x.sec >= base && x.sec % base === 0);
          if (ok.length) {
            setData(rows);
            setFileName(saved.name);
            setBaseSec(base);
            setTf(ok.find((x) => x.sec === st.tf)?.sec ?? ok[0].sec);
            setPos(Math.min(Math.max(0, st.pos ?? 0), rows.length - 1));
          }
        }
        const setters = {
          tzMode: setTzMode, drawings: setDrawings, sessionTrades: setSessionTrades, position: setPosition,
          visible: setVisible, slPts: setSlPts, tpPts: setTpPts, contracts: setContracts,
          pointValue: setPointValue, commission: setCommission, dailyLimit: setDailyLimit,
          session: setSession, speed: setSpeed, showSessions: setShowSessions,
            panelOpen: setPanelOpen, axisCsv: setAxisCsv, priceColor: setPriceColor, priceOpacity: setPriceOpacity, bullColor: setBullColor, bearColor: setBearColor
        };
        Object.entries(setters).forEach(([k, fn]) => {
          if (st[k] !== undefined && st[k] !== null) fn(st[k]);
        });
      } catch {
        /* sin datos guardados o navegador sin IndexedDB */
      } finally {
        if (!cancelled) {
          setReady(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
    
  // Auto-carga del CSV maestro si no hay datos locales (para visitantes nuevos)
  useEffect(() => {
    if (!ready) return undefined;
    if (data.length > 0) return undefined;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(CLOUD_CSV_URL);
        if (!res.ok) throw new Error('No se pudo bajar el CSV de la nube');
        const text = await res.text();
        if (cancelled) return;
        const rows = parseCsv(text);
        loadData(rows, 'NAS100 (cloud)', 'server7');
      } catch (err) {
        if (!cancelled) setError('Cloud: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  // Guardar estado (máximo ~1 vez por segundo mientras reproduces, y al quedar quieto)
  useEffect(() => {
    if (!ready) return undefined;
    const write = () => {
      lastSaveRef.current = Date.now();
      try {
        localStorage.setItem(
          STATE_KEY,
          JSON.stringify({
            pos, tf, tzMode, drawings, sessionTrades, position, visible, slPts, tpPts,
            contracts, pointValue, commission, dailyLimit, session, speed, showSessions, panelOpen, axisCsv, priceColor, priceOpacity, bullColor, bearColor
          })
        );
      } catch {
        /* almacenamiento lleno */
      }
    };
    if (Date.now() - lastSaveRef.current > 1000) {
      write();
      return undefined;
    }
    const id = setTimeout(write, 300);
    return () => clearTimeout(id);
  }, [ready, pos, tf, tzMode, drawings, sessionTrades, position, visible, slPts, tpPts, contracts, pointValue, commission, dailyLimit, session, speed, showSessions, panelOpen, axisCsv, priceColor, priceOpacity, bullColor, bearColor]);

  // 🎓 Challenge: actualiza el balance cuando se cierra una operación
  useEffect(() => {
    if (challengeStatus !== 'running') return;
    if (!sessionTrades.length) return;
    const last = sessionTrades[sessionTrades.length - 1];
    if (!last || last._challengeApplied) return;

    const pnl = last.pnlUSD || 0;
    const newBalance = challengeBalance + pnl;
    setChallengeBalance(newBalance);

    // Marcar la operación como ya aplicada (para no duplicar)
    setSessionTrades((prev) =>
      prev.map((t) => (t.id === last.id ? { ...t, _challengeApplied: true } : t))
    );

    // Evaluar fin del Challenge
    const profit = newBalance - challengeInitial;
    const target = challengeInitial * (challengePhase === 'eval' ? 0.06 : 0.04);

    if (profit >= target) {
      setChallengeStatus('passed');
    } else {
      // Pérdida diaria EOD: suma de pnlUSD de trades del mismo día
      const day = last.dateISO;
      const dayPnL = sessionTrades
        .filter((t) => t.dateISO === day)
        .reduce((acc, t) => acc + (t.pnlUSD || 0), 0);
      if (dayPnL <= -(challengeInitial * 0.04)) {
        setChallengeStatus('blown');
      }
    }
  }, [sessionTrades, challengeStatus, challengeBalance, challengeInitial, challengePhase]);
    const forgetSaved = () => {
    const doForget = async () => {
      try {
        await idbDel('data');
      } catch {
        /* nada que borrar */
      }
      localStorage.removeItem(STATE_KEY);
      setData([]);
      setFileName('');
      setPosition(null);
      setSessionTrades([]);
      setDrawings([]);
      setPlaying(false);
    };
    if (onRequestAuth) onRequestAuth(doForget);
    else doForget();
  };

  // Estadísticas en vivo: operaciones del replay ya guardadas + las que aún no guardas
  const stats = useMemo(() => {
    const list = [...savedTrades.filter((t) => t.pnlUSD !== undefined), ...sessionTrades].sort(
      (a, b) => (a.dateISO || '').localeCompare(b.dateISO || '') || a.id - b.id
    );
    let cum = 0;
    let peak = 0;
    let dd = 0;
    let gw = 0;
    let gl = 0;
    let wins = 0;
    let totalR = 0;
    const curve = [0];
    list.forEach((t) => {
      cum += t.pnlUSD;
      totalR += t.resultR;
      if (cum > peak) peak = cum;
      dd = Math.max(dd, peak - cum);
      if (t.outcome === 'WIN') wins++;
      if (t.pnlUSD > 0) gw += t.pnlUSD;
      else if (t.pnlUSD < 0) gl -= t.pnlUSD;
      curve.push(cum);
    });
    const cLo = Math.min(0, ...curve);
    const cHi = Math.max(0, ...curve);
    const span = cHi - cLo || 1;
    const yy = (val) => 65 - ((val - cLo) / span) * 60;
    return {
      n: list.length,
      winRate: list.length ? (wins / list.length) * 100 : 0,
      total: cum,
      totalR,
      dd,
      pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
      pts: curve.map((val, i) => `${(i / Math.max(1, curve.length - 1)) * 300},${yy(val)}`).join(' '),
      zeroY: yy(0)
    };
  }, [savedTrades, sessionTrades]);

  const atEnd = data.length > 0 && pos >= data.length - 1;

  return (
    <div className="fixed inset-0 md:static md:inset-auto md:h-auto overflow-hidden md:overflow-visible flex flex-col md:block md:space-y-4">
     

      {/* MÓVIL: MENÚ HAMBURGUESA */}
      {mobileMenuOpen && (
          <div className="fixed inset-0 z-[70] flex">
          <div className="flex-1 bg-black/70" onClick={() => setMobileMenuOpen(false)} />
                   <div className="w-[85%] max-w-sm md:w-96 md:max-w-md bg-slate-900 border-l border-slate-800 overflow-y-auto p-4 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-sm font-bold text-white font-mono leading-tight">JZ_BACKTEST_LAB</h2>
                <p className="text-[10px] text-emerald-400 font-mono">NAS100 · UAT</p>
              </div>
                            <div className="flex gap-1.5">
                <button
                  onClick={() => { setMobileMenuOpen(false); if (onGoToRegistro) onGoToRegistro(); }}
                  className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-lg px-2 py-1 cursor-pointer"
                  title="Ir a la pestaña Registro"
                >
                  ← Registro
                </button>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="text-slate-400 text-xl leading-none w-8 h-8 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Datos</p>
              <label className="block w-full text-center px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 border border-emerald-400 font-bold text-xs font-mono cursor-pointer">
                Cargar CSV
                <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
              </label>
              <button
                onClick={() => { loadData(genSample(), 'datos-simulados (1m)', 'ny'); setMobileMenuOpen(false); }}
                className="block w-full text-center px-3 py-2 rounded-lg bg-slate-950 text-slate-300 border border-slate-800 text-xs font-mono cursor-pointer"
              >
                Datos de ejemplo
              </button>
              {data.length > 0 && (
                <button
                  onClick={forgetSaved}
                  className="block w-full text-center px-3 py-2 rounded-lg bg-slate-950 text-slate-400 border border-slate-800 text-xs font-mono cursor-pointer"
                >
                  Olvidar datos guardados
                </button>
              )}
              {fileName && (
                <p className="text-[10px] font-mono text-slate-500">
                  {fileName} — {data.length} velas
                </p>
              )}
              {error && <p className="text-[11px] font-mono text-rose-400">{error}</p>}
            </div>

                                    <div className="border-t border-slate-800 pt-3 space-y-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Operativa</p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">SL (puntos)</label>
                  <input type="number" min="0" step="any" value={slPts} onChange={(e) => setSlPts(e.target.value)} disabled={!!position} className={fieldClass} />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">TP (puntos)</label>
                  <input type="number" min="0" step="any" value={tpPts} onChange={(e) => setTpPts(e.target.value)} disabled={!!position} className={fieldClass} />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">Sesión</label>
                  <select value={session} onChange={(e) => setSession(e.target.value)} disabled={!!position} className={fieldClass}>
                    <option value="NY">NY</option>
                    <option value="LONDON">Londres</option>
                    <option value="ASIA">Asia</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">Contratos</label>
                  <input type="number" min="1" step="1" value={contracts} onChange={(e) => setContracts(e.target.value)} disabled={!!position} className={fieldClass} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">Valor por punto ($)</label>
                  <input type="number" min="0" step="any" value={pointValue} onChange={(e) => setPointValue(e.target.value)} disabled={!!position} className={fieldClass} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">Comisión / contrato ($, ida y vuelta)</label>
                  <input type="number" min="0" step="any" value={commission} onChange={(e) => setCommission(e.target.value)} disabled={!!position} className={fieldClass} />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-500 font-mono mb-1">Límite pérdida diaria ($, 0 = sin límite)</label>
                  <input type="number" min="0" step="any" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={fieldClass} />
                </div>
              </div>

              <p className="text-[10px] font-mono text-slate-500">
                {CONTRACT_SYMBOL} · Riesgo ${riskUSD.toFixed(2)} · Objetivo ${rewardUSD.toFixed(2)} · P&L día {dailyPnL >= 0 ? '+' : '-'}${Math.abs(dailyPnL).toFixed(2)}
              </p>
                                      
              <div className="border-t border-slate-800 pt-3 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">🎓 Challenge</p>

                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-mono text-slate-400 flex-1">Balance inicial</label>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={challengeInitial}
                    onChange={(e) => setChallengeInitial(Number(e.target.value) || 25000)}
                    disabled={challengeStatus === 'running'}
                    className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white font-mono text-right"
                  />
                </div>

                <button
                  onClick={startChallenge}
                  disabled={challengeStatus === 'running' || !!position}
                  className="block w-full text-center px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 border border-emerald-400 font-bold text-xs font-mono cursor-pointer disabled:opacity-40"
                >
                  🎓 Iniciar Challenge Aleatorio
                </button>

             <p className="text-[11px] font-mono text-slate-500 text-center">
                  Estado: <span className="text-slate-400">{challengeStatus === 'idle' ? 'Inactivo' : challengeStatus === 'running' ? 'En curso 🟢' : challengeStatus === 'passed' ? 'Superado 🏆' : 'Quemada ❌'}</span>
                </p>

                {/* TARJETA INFORMATIVA - REGLA DE CONSISTENCIA (40%) */}
                <div className={`mt-2 p-2 rounded border text-[11px] font-mono ${
                  isAbove40PercentProfit 
                    ? 'bg-rose-950/40 border-rose-500/50 text-rose-300' 
                    : 'bg-slate-950/60 border-slate-800 text-slate-400'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold flex items-center gap-1">
                      {isAbove40PercentProfit ? '⚠️' : '⚖️'} Regla 40% (Consistencia)
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${
                      isAbove40PercentProfit 
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' 
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {isAbove40PercentProfit ? 'Violada' : 'En regla'}
                    </span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-400">
                    {isAbove40PercentProfit 
                      ? 'Un trade individual superó el 40% del profit objetivo ($600). Cuenta no apta para retiro/aprobación.' 
                      : 'Ningún trade debe superar el 40% del objetivo de ganancia ($600 máx por trade).'}
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Precio actual</p>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-mono text-slate-400 flex-1">Color</label>
                  <input
                    type="color"
                    value={priceColor}
                    onChange={(e) => setPriceColor(e.target.value)}
                    className="w-10 h-8 rounded border border-slate-700 cursor-pointer bg-slate-950"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-mono text-slate-400">Opacidad</label>
                    <span className="text-[11px] font-mono text-slate-500">{Math.round(priceOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={priceOpacity}
                    onChange={(e) => setPriceOpacity(Number(e.target.value))}
                    className="w-full accent-emerald-500 h-1 cursor-pointer"
                  />
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Velas</p>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-mono text-slate-400 flex-1">Alcista (sube)</label>
                  <input
                    type="color"
                    value={bullColor}
                    onChange={(e) => setBullColor(e.target.value)}
                    className="w-10 h-8 rounded border border-slate-700 cursor-pointer bg-slate-950"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-mono text-slate-400 flex-1">Bajista (baja)</label>
                  <input
                    type="color"
                    value={bearColor}
                    onChange={(e) => setBearColor(e.target.value)}
                    className="w-10 h-8 rounded border border-slate-700 cursor-pointer bg-slate-950"
                  />
                </div>
              </div>

              {position ? (
                <div className="space-y-2">
                  <div className="text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 space-y-1">
                    <p className="text-slate-300 font-bold">{position.type} {position.contracts}x {CONTRACT_SYMBOL}</p>
                    <p className="text-slate-400 text-[10px]">E {position.entry} · SL {position.sl} · TP {position.tp}</p>
                    <p className={`font-bold ${floatUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {floatPts >= 0 ? '+' : ''}{floatPts.toFixed(2)} pts · {floatUSD >= 0 ? '+' : '-'}${Math.abs(floatUSD).toFixed(2)} · {floatR >= 0 ? '+' : ''}{floatR.toFixed(2)}R
                    </p>
                  </div>
                  <button onClick={closeAtMarket} className={`${btn} w-full bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700`}>
                    Cerrar a mercado
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 font-mono">Nuevo SL</label>
                      <input type="number" step="any" value={editSl} onChange={(e) => setEditSl(e.target.value)} className={fieldClass} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 font-mono">Nuevo TP</label>
                      <input type="number" step="any" value={editTp} onChange={(e) => setEditTp(e.target.value)} className={fieldClass} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={applyLevels} className={`${btn} flex-1 bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}>
                      Aplicar
                    </button>
                    <button onClick={moveToBreakEven} className={`${btn} flex-1 bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}>
                      Break-even
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => { openPosition('SELL'); setMobileMenuOpen(false); }}
                    disabled={atEnd || limitHit}
                    className={`${btn} flex-1 bg-rose-500 text-slate-950 border-rose-400 font-bold disabled:opacity-40`}
                  >
                    Vender
                  </button>
                  <button
                    onClick={() => { openPosition('BUY'); setMobileMenuOpen(false); }}
                    disabled={atEnd || limitHit}
                    className={`${btn} flex-1 bg-emerald-500 text-slate-950 border-emerald-400 font-bold disabled:opacity-40`}
                  >
                    Comprar
                  </button>
                </div>
              )}
            </div>

            {stats.n > 0 && (
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Estadísticas</p>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">Trades</p>
                    <p className="text-sm font-bold text-white mt-0.5">{stats.n}</p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">Win Rate</p>
                    <p className="text-sm font-bold text-white mt-0.5">{stats.winRate.toFixed(1)}%</p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">R total</p>
                    <p className={`text-sm font-bold mt-0.5 ${stats.totalR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {stats.totalR >= 0 ? '+' : ''}{stats.totalR.toFixed(2)}R
                    </p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">P&L neto</p>
                    <p className={`text-sm font-bold mt-0.5 ${stats.total >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {stats.total >= 0 ? '+' : '-'}${Math.abs(stats.total).toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">Profit Factor</p>
                    <p className="text-sm font-bold text-white mt-0.5">
                      {stats.pf === Infinity ? '∞' : stats.pf.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                    <p className="text-[9px] uppercase tracking-widest text-slate-500">Max DD</p>
                    <p className="text-sm font-bold text-rose-400 mt-0.5">-${stats.dd.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            )}

            {sessionTrades.length > 0 && (
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">
                  Sin guardar ({sessionTrades.length})
                </p>
                <button
                  onClick={handleSave}
                  className="block w-full text-center px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 border border-emerald-400 font-bold text-xs font-mono cursor-pointer"
                >
                  Guardar en registro 🔒
                </button>
                          <button
            onClick={handleClearSession}
            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors"
            title="Vaciar trades de sesión sin guardar"
          >
            🗑️ Vaciar
          </button>
                <ul className="space-y-1 text-[11px] font-mono">
                  {sessionTrades.map((t) => (
                    <li key={t.id} className="flex justify-between text-slate-400">
                      <span>{t.date} - {t.type}</span>
                      <span className={t.resultR > 0 ? 'text-emerald-400' : t.resultR < 0 ? 'text-rose-400' : 'text-slate-400'}>
                        {t.resultR > 0 ? '+' : ''}{t.resultR}R
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CARGA DE DATOS (escritorio) */}
      <div className="hidden">        
        <label className={`${btn} bg-emerald-500 text-slate-950 border-emerald-400 font-bold`}>
          Cargar CSV
          <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
        </label>
        <button
          onClick={() => loadData(genSample(), 'datos-simulados (1m)', 'ny')}
          className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}
        >
          Datos de ejemplo
        </button>
        {fileName && (
          <span className="text-slate-400">
            {fileName} - {data.length} velas - base {TIMEFRAMES.find((x) => x.sec === baseSec)?.label || `${baseSec}s`}
          </span>
        )}
        {loading && <span className="text-slate-400">Procesando datos...</span>}
        {data.length > 0 && (
          <button
            onClick={forgetSaved}
            className={`${btn} bg-slate-950 text-slate-400 border-slate-800 hover:text-rose-300`}
            title="Borra el CSV y el estado guardados en este navegador"
          >
            Olvidar datos guardados
          </button>
        )}
        {error && <span className="text-rose-400">{error}</span>}
      </div>

      {data.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-xs font-mono text-slate-500 space-y-2">
          <p>Carga un CSV con encabezados: time (o date + time), open, high, low, close.</p>
          <p>Los datos de ejemplo sirven solo para probar el replay, no para evaluar estrategias.</p>
        </div>
      ) : (
        <>
          {/* GRÁFICO */}
          <div className="flex-1 min-h-0 flex flex-col bg-slate-900 border border-slate-800 md:rounded-2xl p-0 md:p-4 gap-0 md:gap-3">
            <div className="hidden">              
              <div className="flex flex-wrap gap-1.5">
                {allowed.map((x) => (
                  <button
                    key={x.sec}
                   onClick={() => {
                      setTf(x.sec);
                      setPan(0);
                      setYRange(null);
                    }}
                    className={`${btn} ${
                      tf === x.sec
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">
                  {fmtTime(data[pos].t)} - {data[pos].c.toFixed(2)}
                </span>
                <button
                  onClick={() => setPanelOpen((o) => !o)}
                  aria-label="Mostrar u ocultar el panel de órdenes"
                  title={panelOpen ? 'Ocultar panel de órdenes' : 'Mostrar panel de órdenes'}
                  className={`${btn} text-base leading-none ${
                    panelOpen
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white'
                  }`}
                >
                  ☰
                </button>
              </div>
            </div>

            <div className="hidden">
              <button
                onClick={() => setVisible(ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(visible) - 1)])}
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}
              >
                Acercar
              </button>
              <button
                onClick={() => setVisible(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(visible) + 1)])}
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}
              >
                Alejar
              </button>
              <button
                onClick={() => setPan((p) => Math.min(p + Math.ceil(visible / 4), Math.max(0, findAggIndex(agg, pos) - Math.floor(visible / 3))))}
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}
              >
                ◀ Atrás
              </button>
              <button
                onClick={() => setPan((p) => Math.max(0, p - Math.ceil(visible / 4)))}
                disabled={pan === 0}
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white disabled:opacity-40`}
              >
                Adelante ▶
              </button>
              {pan > 0 && (
                <button onClick={() => setPan(0)} className={`${btn} bg-emerald-500 text-slate-950 border-emerald-400 font-bold`}>
                  Ir al presente
                </button>
              )}
              {yRange && (
                <button onClick={() => setYRange(null)} className={`${btn} bg-emerald-500 text-slate-950 border-emerald-400 font-bold`}>
                  Resetear zoom Y
                </button>
              )}
              <span className="text-[10px] font-mono text-slate-500 ml-1">{visible} velas</span>
              <button
                onClick={() => setAxisCsv((x) => !x)}
                title="Hora que muestra el eje inferior"
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}
              >
                Eje: {axisCsv ? 'hora CSV' : 'hora NY'}
              </button>
              <label className="flex items-center gap-1 text-[10px] font-mono text-slate-400 ml-2 cursor-pointer">
                <input type="checkbox" checked={showSessions} onChange={(e) => setShowSessions(e.target.checked)} className="accent-emerald-500" />
                Sesiones
              </label>
              <select
                value={tzMode}
                onChange={(e) => setTzMode(e.target.value)}
                title="Zona horaria de las horas del CSV"
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-300"
              >
                {TZ_MODES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="hidden">
              <span className="text-[10px] font-mono text-slate-500 mr-1">Dibujo:</span>
              {[
                ['cursor', 'Cursor'],
                ['line', 'Línea'],
                ['rect', 'Rectángulo'],
                ['fib', 'Fib 50%']
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTool(id)}
                  className={`${btn} ${
                    tool === id
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="mx-1 text-slate-700">|</span>
              <button
                onClick={deleteSelected}
                disabled={!selectedId}
                className={`${btn} bg-slate-950 text-rose-400 border-rose-500/30 hover:text-rose-300 disabled:opacity-40`}
              >
                Borrar seleccionado
              </button>
              <button
                onClick={() => {
                  updateDrawings(() => []);
                  select(null);
                  drawOverlay();
                }}
                disabled={!drawings.length}
                className={`${btn} bg-slate-950 text-rose-400 border-rose-500/30 hover:text-rose-300 disabled:opacity-40`}
              >
                Borrar todo ({drawings.length})
              </button>
              {[
                ['cursor', 'Cursor'],
                ['line', 'Líneas'],
                ['rect', 'Rectángulos'],
                ['fib', 'Fib']
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    updateDrawings((prev) => prev.filter((d) => d.type !== id));
                    select(null);
                    drawOverlay();
                  }}
                  disabled={!count(id)}
                  className={`${btn} bg-slate-950 text-slate-400 border-slate-800 hover:text-white disabled:opacity-40`}
                >
                  Borrar {label.toLowerCase()} ({count(id)})
                </button>
              ))}
            </div>

            <p className="hidden">
              Con Cursor: clic para seleccionar, arrastra para mover, arrastra los puntos para editar, Supr para borrar.
              Con cualquier herramienta: mantén <kbd className="px-1 py-0.5 bg-slate-800 rounded text-slate-300">Shift</kbd> para ángulo recto (0°/45°/90°).
              Zoom: arrastra <span className="text-slate-300">horizontal</span> sobre el eje de tiempo (abajo) o <span className="text-slate-300">vertical</span> sobre el eje de precio (derecha).
            </p>

            {showSessions && (
              <div className="hidden md:flex flex-wrap gap-3 text-[10px] font-mono">
                {SESSIONS.map((x) => (
                  <span key={x.id} style={{ color: x.color }}>
                    ■ {x.label} {x.start}-{x.end} ET
                  </span>
                ))}
              </div>
            )}
            
            {/* BARRA COMPACTA PEGADA AL GRÁFICO */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Abrir menú"
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-base leading-none cursor-pointer"
              >
                ☰
              </button>
              <div className="flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex gap-1">
                  {data.length > 0 && allowed.map((x) => (
                    <button
                      key={x.sec}
                      onClick={() => {
                        setTf(x.sec);
                        setPan(0);
                        setYRange(null);
                      }}
                      className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                        tf === x.sec
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                          : 'bg-slate-950 text-slate-400 border-slate-800'
                      }`}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setMobileToolsOpen((o) => !o)}
                aria-label="Herramientas de dibujo"
                className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border text-base leading-none cursor-pointer ${
                  mobileToolsOpen
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-slate-950 text-slate-300 border-slate-800'
                }`}
              >
                ✏️
              </button>
            </div>

            {/* MÓVIL: FRANJA HERRAMIENTAS PEGADA AL GRÁFICO */}
            {mobileToolsOpen && data.length > 0 && (
               <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[
                  ['cursor', 'Cursor'],
                  ['line', 'Línea'],
                  ['rect', 'Rect'],
                  ['fib', 'Fib']
                ].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setTool(id)}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                      tool === id
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                                <button
                  onClick={() => setAngleLock((a) => !a)}
                  title={angleLock ? 'Ángulo recto activo (0°/45°/90°)' : 'Trazo libre'}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                    angleLock
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                      : 'bg-slate-950 text-slate-300 border-slate-800'
                  }`}
                >
                  📐
                </button>
                <button
                  onClick={() => setAxisLock((a) => !a)}
                  title={axisLock ? 'Ejes bloqueados (solo panea)' : 'Ejes activos (zoom disponible)'}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                    axisLock
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                      : 'bg-slate-950 text-slate-300 border-slate-800'
                  }`}
                >
                  🎯
                </button>
                                 <button
                  onClick={() => setPanLock((p) => !p)}
                  title={panLock ? 'Paneo bloqueado (solo crosshair)' : 'Paneo libre activo'}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                    panLock
                      ? 'bg-rose-500 text-slate-950 border-rose-400 font-bold'
                      : 'bg-slate-950 text-slate-300 border-slate-800'
                  }`}
                >
                  {panLock ? '🔒' : '🔓'}
                </button>
                <button
                  onClick={deleteSelected}
                  disabled={!selectedId}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border bg-slate-950 text-rose-400 border-rose-500/30 disabled:opacity-40 cursor-pointer"
                >
                  Borrar
                </button>
                <button
                  onClick={() => { updateDrawings(() => []); select(null); drawOverlay(); }}
                  disabled={!drawings.length}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-mono border bg-slate-950 text-rose-400 border-rose-500/30 disabled:opacity-40 cursor-pointer"
                >
                  Borrar todo ({drawings.length})
                </button>
              </div>
            )}

            <div ref={chartWrapRef} className="relative flex-1 min-h-0 md:flex-none md:aspect-[9/4]">
               <canvas ref={canvasRef} width={900} height={400} className="absolute inset-0 w-full h-full rounded-lg bg-slate-950" />
              <canvas
                ref={overlayRef}
                width={900}
                height={400}
                className="absolute inset-0 w-full h-full outline-none"
                style={{ cursor: tool === 'cursor' ? 'default' : 'crosshair', touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerEnter={onPointerMove}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerLeave}
                tabIndex={0}
                onKeyDown={onKeyDown}
              />
                            {/* BARRA FLOTANTE DE REPRODUCCIÓN (TradingView style) */}
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg px-1.5 py-1 shadow-lg">
                <button
                  onClick={() => setPlaying(!playing)}
                  disabled={atEnd}
                  className="px-2 py-1 rounded text-xs font-mono font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40 cursor-pointer"
                  title={playing ? 'Pausa' : 'Reproducir'}
                >
                  {playing ? '⏸' : '▶'}
                </button>
                <button
                  onClick={() => stepRef.current(1)}
                  disabled={atEnd}
                  className="px-2 py-1 rounded text-xs font-mono bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  title="+1 vela base"
                >
                  +1
                </button>
                <button
                  onClick={nextCandle}
                  disabled={atEnd}
                  className="px-2 py-1 rounded text-xs font-mono bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  title={`Siguiente vela ${tfLabel}`}
                >
                  ⏭
                </button>
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="bg-slate-800 border border-slate-700 rounded text-xs font-mono text-slate-200 px-1 py-0.5 cursor-pointer"
                  title="Velocidad"
                >
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}x
                    </option>
                  ))}
                </select>
              </div>

              {/* Ejecución rápida: funciona aunque el panel de órdenes esté oculto */}
                            <div className="hidden md:flex md:absolute md:bottom-auto md:left-auto md:right-[10.5%] md:top-2 md:z-10 items-center justify-end gap-1">
                {position ? (
                  <button
                    onClick={closeAtMarket}
                    className={`${btn} bg-slate-800 border-slate-600 font-bold ${floatUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    Cerrar {floatUSD >= 0 ? '+' : '-'}${Math.abs(floatUSD).toFixed(2)}
                  </button>
                ) : (
                  <>
                    <span className="hidden md:inline text-[10px] font-mono text-slate-400 mr-1">
                      {nContracts}x - SL {slPts} - TP {tpPts}
                    </span>
                    {isAbove40PercentProfit && (
                      <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-500/50 flex items-center gap-1 animate-pulse">
                        ⚠️ Regla 40% Violada (Trading Bloqueado)
                      </span>
                    )}
                    <button
                      onClick={() => openPosition('SELL')}
                      disabled={atEnd || limitHit || challengeStatus === 'blown' || isAbove40PercentProfit}
                      className={`${btn} bg-rose-500 text-slate-950 border-rose-400 font-bold disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      Vender
                    </button>
                    <button
                      onClick={() => openPosition('BUY')}
                      disabled={atEnd || limitHit || challengeStatus === 'blown' || isAbove40PercentProfit}
                      className={`${btn} bg-emerald-500 text-slate-950 border-emerald-400 font-bold disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      Comprar
                    </button>
                  </>
                )}
              </div>
              
             {/* 🎓 HUD flotante del Challenge */}
              {challengeStatus === 'running' && (
                <div className="absolute bottom-2 left-2 z-10 bg-slate-900/90 backdrop-blur border border-emerald-500/40 rounded-lg px-2.5 py-1.5 shadow-lg text-[10px] font-mono text-slate-300 space-y-0.5 pointer-events-none select-none">
                  <div className="flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">🎓 CHALLENGE</span>
                    <span className="text-[9px] text-slate-500">
                      {challengePhase === 'eval' ? 'Evaluación' : 'Fondeada'}
                    </span>
                  </div>
                  <div className="text-white font-bold text-sm">
                    ${challengeBalance.toFixed(2)}
                  </div>
                  <div className={challengeBalance - challengeInitial >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {challengeBalance - challengeInitial >= 0 ? '+' : ''}
                    ${(challengeBalance - challengeInitial).toFixed(2)}
                    {' '}
                    ({((challengeBalance - challengeInitial) / challengeInitial * 100).toFixed(2)}%)
                  </div>
                  <div className="text-[9px] text-slate-500">
                    Objetivo: {challengePhase === 'eval' ? '+6%' : '+4%'}
                    {' '}(${(challengeInitial * (challengePhase === 'eval' ? 0.06 : 0.04)).toFixed(0)})
                  </div>
                  {isAbove40PercentProfit && (
                    <div className="mt-1 pt-1 border-t border-amber-500/30 text-amber-400 font-bold text-[9px] flex items-center gap-1">
                      <span>⚠️</span>
                      <span>Regla 40%: Trade &gt; $600</span>
                    </div>
                  )}
                </div>
              )}

            </div>

            <div className="hidden">
              <button
                onClick={() => setPlaying(!playing)}
                disabled={atEnd}
                className={`${btn} bg-emerald-500 text-slate-950 border-emerald-400 font-bold disabled:opacity-40`}
              >
                {playing ? 'Pausa' : 'Reproducir'}
              </button>
              <button
                onClick={() => stepRef.current(1)}
                disabled={atEnd}
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white disabled:opacity-40`}
              >
                +1 vela base
              </button>
              <button
                onClick={nextCandle}
                disabled={atEnd}
                className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white disabled:opacity-40`}
              >
                Siguiente vela {tfLabel}
              </button>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-300"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s} velas/s
                  </option>
                ))}
              </select>
            </div>

                        <div className="px-1 pt-0.5 pb-0">
              <input
                type="range"
                min={0}
                max={data.length - 1}
                value={pos}
                disabled={!!position}
                onChange={(e) => {
                  setPlaying(false);
                  setPos(Number(e.target.value));
                }}
                className="w-full accent-emerald-500 disabled:opacity-40 h-1 cursor-pointer"
              />
            </div>
            
            {/* MÓVIL: BOTONES VENDER/COMPRAR GRANDES */}
            <div className="md:hidden flex gap-2 pt-1">
              {position ? (
                <button
                  onClick={closeAtMarket}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm font-mono cursor-pointer ${
                    floatUSD >= 0
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-rose-500 text-slate-950'
                  }`}
                >
                  Cerrar {floatUSD >= 0 ? '+' : '-'}${Math.abs(floatUSD).toFixed(2)}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => openPosition('SELL')}
                    disabled={atEnd || limitHit || challengeStatus === 'blown'}
                    className="flex-1 py-3 rounded-xl bg-rose-500 text-slate-950 font-bold text-sm font-mono cursor-pointer disabled:opacity-40"
                  >
                    Vender
                  </button>
                  <button
                    onClick={() => openPosition('BUY')}
                    disabled={atEnd || limitHit || challengeStatus === 'blown'}
                    className="flex-1 py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm font-mono cursor-pointer disabled:opacity-40"
                  >
                    Comprar
                  </button>
                </>
              )}
            </div>
          </div>

          {/* OPERATIVA (colapsable con el botón ☰) */}
          {panelOpen && (
          <>
          <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setPanelOpen(false)} />
          <div className="fixed md:static bottom-0 left-0 right-0 z-50 md:z-auto max-h-[80vh] overflow-y-auto md:max-h-none md:overflow-visible bg-slate-900 border-t md:border border-slate-800 rounded-t-2xl md:rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-center md:hidden">
              <span className="text-xs font-mono text-slate-400">Panel de órdenes</span>
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 text-lg leading-none cursor-pointer">✕</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">SL (puntos)</label>
                <input type="number" min="0" step="any" value={slPts} onChange={(e) => setSlPts(e.target.value)} disabled={!!position} className={fieldClass} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">TP (puntos)</label>
                <input type="number" min="0" step="any" value={tpPts} onChange={(e) => setTpPts(e.target.value)} disabled={!!position} className={fieldClass} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">Sesión</label>
                <select value={session} onChange={(e) => setSession(e.target.value)} disabled={!!position} className={fieldClass}>
                  <option value="NY">NY</option>
                  <option value="LONDON">Londres</option>
                  <option value="ASIA">Asia</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">Contratos</label>
                <input type="number" min="1" step="1" value={contracts} onChange={(e) => setContracts(e.target.value)} disabled={!!position} className={fieldClass} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">Valor por punto ($)</label>
                <input type="number" min="0" step="any" value={pointValue} onChange={(e) => setPointValue(e.target.value)} disabled={!!position} className={fieldClass} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">Comisión/contrato ($, ida y vuelta)</label>
                <input type="number" min="0" step="any" value={commission} onChange={(e) => setCommission(e.target.value)} disabled={!!position} className={fieldClass} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-mono mb-1">Límite pérdida diaria ($, 0 = sin límite)</label>
                <input type="number" min="0" step="any" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={fieldClass} />
              </div>
            </div>

            <p className="text-[11px] font-mono text-slate-500">
              {CONTRACT_SYMBOL} - Riesgo: ${riskUSD.toFixed(2)} - Objetivo: ${rewardUSD.toFixed(2)} (netos de comisión) - P&L del día: {dailyPnL >= 0 ? '+' : '-'}${Math.abs(dailyPnL).toFixed(2)}
            </p>

            {limitHit && (
              <p className="text-xs text-rose-400 font-mono">
                Límite de pérdida diaria alcanzado: sin nuevas entradas hoy.
              </p>
            )}

            {position ? (
              <>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                <span className="text-slate-300">
                  {position.type} {position.contracts}x {CONTRACT_SYMBOL} en {position.entry} - SL {position.sl} - TP {position.tp}
                </span>
                <span className={`font-bold ${floatUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {floatPts >= 0 ? '+' : ''}{floatPts.toFixed(2)} pts - {floatUSD >= 0 ? '+' : '-'}${Math.abs(floatUSD).toFixed(2)} - {floatR >= 0 ? '+' : ''}{floatR.toFixed(2)}R
                </span>
                <button onClick={closeAtMarket} className={`${btn} bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700`}>
                  Cerrar a mercado
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-2 text-xs font-mono">
                <div className="w-32">
                  <label className="block text-[10px] text-slate-500 mb-1">Nuevo SL (precio)</label>
                  <input type="number" step="any" value={editSl} onChange={(e) => setEditSl(e.target.value)} className={fieldClass} />
                </div>
                <div className="w-32">
                  <label className="block text-[10px] text-slate-500 mb-1">Nuevo TP (precio)</label>
                  <input type="number" step="any" value={editTp} onChange={(e) => setEditTp(e.target.value)} className={fieldClass} />
                </div>
                <button onClick={applyLevels} className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}>
                  Aplicar
                </button>
                <button onClick={moveToBreakEven} className={`${btn} bg-slate-950 text-slate-300 border-slate-800 hover:text-white`}>
                  Break-even
                </button>
              </div>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => openPosition('BUY')}
                  disabled={atEnd || limitHit || challengeStatus === 'blown'}
                  className={`${btn} flex-1 bg-emerald-500 text-slate-950 border-emerald-400 font-bold disabled:opacity-40`}
                >
                  Comprar (BUY)
                </button>
                <button
                  onClick={() => openPosition('SELL')}
                  disabled={atEnd || limitHit || challengeStatus === 'blown'}
                  className={`${btn} flex-1 bg-rose-500 text-slate-950 border-rose-400 font-bold disabled:opacity-40`}
                >
                  Vender (SELL)
                </button>
              </div>
            )}
          </div>
          </>
          )}

          {/* ESTADÍSTICAS EN VIVO */}
          {stats.n > 0 && (
            <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-white font-mono">Estadísticas del Replay (en vivo)</h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs font-mono">
                {[
                  ['Trades', stats.n, 'text-white'],
                  ['Win Rate', `${stats.winRate.toFixed(1)}%`, 'text-white'],
                  ['R total', `${stats.totalR >= 0 ? '+' : ''}${stats.totalR.toFixed(2)}R`, stats.totalR >= 0 ? 'text-emerald-400' : 'text-rose-400'],
                  ['P&L neto', `${stats.total >= 0 ? '+' : '-'}$${Math.abs(stats.total).toFixed(2)}`, stats.total >= 0 ? 'text-emerald-400' : 'text-rose-400'],
                  ['Profit Factor', stats.pf === Infinity ? '∞' : stats.pf.toFixed(2), 'text-white'],
                  ['Max DD', `-$${stats.dd.toFixed(2)}`, 'text-rose-400']
                ].map(([label, value, color]) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
                    <p className={`text-base font-bold mt-0.5 ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
              <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="w-full h-20 bg-slate-950 rounded-lg">
                <line x1="0" y1={stats.zeroY} x2="300" y2={stats.zeroY} stroke="#334155" strokeDasharray="3 3" />
                <polyline points={stats.pts} fill="none" stroke="#10b981" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )}

          {/* OPERACIONES DE ESTA SESIÓN */}
          {sessionTrades.length > 0 && (
            <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white font-mono">
                  Operaciones sin guardar ({sessionTrades.length})
                </h3>
                <button
                  onClick={handleSave}
                  className={`${btn} bg-emerald-500 text-slate-950 border-emerald-400 font-bold`}
                >
                  Guardar en registro 🔒
                </button>
              </div>
              <ul className="space-y-1 text-xs font-mono">
                {sessionTrades.map((t) => (
                  <li key={t.id} className="flex justify-between text-slate-400">
                    <span>
                      {t.date} - {t.type} - {t.session}
                    </span>
                    <span className={t.resultR > 0 ? 'text-emerald-400' : t.resultR < 0 ? 'text-rose-400' : 'text-slate-400'}>
                      {t.resultR > 0 ? '+' : ''}{t.resultR}R ({t.pnlUSD >= 0 ? '+' : '-'}${Math.abs(t.pnlUSD).toFixed(2)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

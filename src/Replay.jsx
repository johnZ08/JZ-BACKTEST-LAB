import React, { useState, useEffect, useMemo, useRef } from 'react';

// Desfase en horas para alinear las velas de 1h/4h con tu broker (prueba 0, 1, 2, 3...)
const ALIGN_OFFSET_H = 0;

// Contrato que operas: MNQ = Micro E-mini Nasdaq-100, $2 por punto (tick de 0.25 = $0.50).
// Cambia el código cuando cambie el vencimiento (H=mar, M=jun, U=sep, Z=dic + último dígito del año).
const CONTRACT_SYMBOL = 'MNQZ6';
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
  if (rows.length < 2) throw new Error('No pude leer velas válidas en el archivo.');
  return rows;
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
  ctx.lineWidth = 1.5;
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

export default function Replay({ onSave, savedTrades = [] }) {
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
  const [showSessions, setShowSessions] = useState(true);
  const [tool, setTool] = useState('cursor'); // cursor | line | rect | fib
  const [drawings, setDrawings] = useState([]);
  const [ready, setReady] = useState(false); // true cuando terminó de restaurar lo guardado
  const [loading, setLoading] = useState(true);
  const [tzMode, setTzMode] = useState('server7'); // zona horaria de las horas del CSV
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [position, setPosition] = useState(null);
  const [sessionTrades, setSessionTrades] = useState([]);
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const viewRef = useRef(null);
  const draftRef = useRef(null);
  const hoverRef = useRef(null);
  const lastSaveRef = useRef(0);
  const stepRef = useRef();

  const allowed = useMemo(
    () => TIMEFRAMES.filter((x) => x.sec >= baseSec && x.sec % baseSec === 0),
    [baseSec]
  );
  const agg = useMemo(() => (data.length ? aggregate(data, tf) : []), [data, tf]);
  const tfLabel = TIMEFRAMES.find((x) => x.sec === tf)?.label || `${tf}s`;

  const visibleCandles = useMemo(() => {
    if (!agg.length) return [];
    const i = findAggIndex(agg, pos);
    const list = agg.slice(Math.max(0, i - visible - pan + 1), i + 1);
    const cur = list[list.length - 1];
    if (cur.lastIdx > pos) {
      // vela en formación: se arma solo con datos ya reproducidos
      let h = -Infinity;
      let l = Infinity;
      for (let k = cur.firstIdx; k <= pos; k++) {
        h = Math.max(h, data[k].h);
        l = Math.min(l, data[k].l);
      }
      list[list.length - 1] = { ...cur, h, l, c: data[pos].c };
    }
    return pan > 0 ? list.slice(0, Math.max(1, list.length - pan)) : list;
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

  const handleSave = () => {
    onSave(sessionTrades, () => setSessionTrades([])); // se vacía solo si autorizas con el PIN
  };

  // Capa estática del gráfico: sesiones, ejes, velas, dibujos y posición
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || visibleCandles.length === 0) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const padR = 84;
    const padY = 16;
    const padB = 30;
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
    const margin = (hi - lo || 1) * 0.06;
    lo -= margin;
    hi += margin;
    const cw = plotW / visible;
    const left = (visible - vc.length) * cw;
    const v = { lo, hi, left, cw, padY, padB, W, H, padR, candles: vc, tf };
    viewRef.current = v;
    const y = (p) => viewPriceToY(v, p);

    // 1) Sesiones (fondo translúcido) y apertura de NY
    const marks = [];
    if (showSessions) {
      const tFrom = vc[0].t;
      const tTo = vc[vc.length - 1].t + tf;
      sessionIntervals(tFrom, tTo, tzMode).forEach(({ s: ses, from, to }) => {
        if (to <= tFrom || from >= tTo) return;
        const x1 = Math.max(left, viewTimeToX(v, from));
        const x2 = Math.min(plotW, viewTimeToX(v, to));
        if (x2 - x1 < 1) return;
        ctx.fillStyle = hexToRgba(ses.color, SESSION_ALPHA);
        ctx.fillRect(x1, 0, x2 - x1, plotH);
        if (x2 - x1 > 46) {
          ctx.font = '10px monospace';
          ctx.fillStyle = hexToRgba(ses.color, 0.75);
          ctx.fillText(ses.label, x1 + 4, plotH - 6);
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
    ctx.font = '11px monospace';
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
      const color = c.c >= c.o ? '#10b981' : '#f43f5e';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.stroke();
      ctx.fillRect(x - cw * 0.35, y(Math.max(c.o, c.c)), cw * 0.7, Math.max(1, Math.abs(y(c.o) - y(c.c))));
    });

    // 4) Dibujos del usuario
    drawings.forEach((d) => drawShape(ctx, v, d));

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
    hline(lastC, '#38bdf8', '');
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(plotW + 2, y(lastC) - 9, padR - 4, 18);
    ctx.fillStyle = '#020617';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(lastC.toFixed(2), plotW + 6, y(lastC) + 4);

    // 6) Eje de tiempo en hora de Nueva York
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, plotH);
    ctx.lineTo(plotW, plotH);
    ctx.stroke();
    const minPerCandle = tf / 60;
    const interval = [1, 5, 15, 30, 60, 120, 240, 360, 720, 1440].find((m) => (m / minPerCandle) * cw >= 70) || 1440;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    let prevBucket = null;
    let prevDay = null;
    vc.forEach((c, i) => {
      const wall = fileToNy(c.t, tzMode);
      const bucket = Math.floor(wall / (interval * 60));
      const day = Math.floor(wall / 86400);
      if (prevBucket !== null && (bucket !== prevBucket || day !== prevDay)) {
        const x = left + i * cw;
        const d = new Date(wall * 1000);
        const label =
          day !== prevDay
            ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}`
            : `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        ctx.beginPath();
        ctx.moveTo(x, plotH);
        ctx.lineTo(x, plotH + 4);
        ctx.stroke();
        ctx.fillText(label, x - 14, plotH + 15);
      }
      prevBucket = bucket;
      prevDay = day;
    });
    ctx.font = 'bold 9px monospace';
    marks.forEach(({ s: ses, x }) => {
      ctx.fillStyle = ses.color;
      ctx.fillRect(x - 1, plotH, 2, 8);
      ctx.fillText(`${ses.label} ${ses.start}`, Math.min(x + 3, plotW - 70), H - 3);
    });
  }, [visibleCandles, position, floatPts, floatUSD, visible, showSessions, tzMode, tf, drawings]);

  // Capa interactiva (cruz del cursor y dibujo en curso): se pinta sin re-renderizar React
  const drawOverlay = () => {
    const cv = overlayRef.current;
    const v = viewRef.current;
    if (!cv || !v) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const h = hoverRef.current;
    if (h && h.x <= v.W - v.padR && h.y <= v.H - v.padB) {
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
      const d = new Date(fileToNy(viewXToTime(v, h.x), tzMode) * 1000);
      const label = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      ctx.fillStyle = '#334155';
      ctx.fillRect(h.x - 22, v.H - v.padB + 2, 44, 16);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(label, h.x - 17, v.H - v.padB + 14);
    }
    if (draftRef.current) drawShape(ctx, v, draftRef.current, 0.9);
  };

  const eventPoint = (e) => {
    const cv = overlayRef.current;
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cv.width) / r.width, y: ((e.clientY - r.top) * cv.height) / r.height };
  };
  const onPointerDown = (e) => {
    const v = viewRef.current;
    if (!v || tool === 'cursor') return;
    const { x, y } = eventPoint(e);
    if (x > v.W - v.padR || y > v.H - v.padB) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = viewXToTime(v, x);
    const p = viewYToPrice(v, y);
    draftRef.current = { type: tool, t1: t, p1: p, t2: t, p2: p };
    hoverRef.current = { x, y };
    drawOverlay();
  };
  const onPointerMove = (e) => {
    const v = viewRef.current;
    if (!v) return;
    const { x, y } = eventPoint(e);
    hoverRef.current = { x, y };
    if (draftRef.current) {
      draftRef.current.t2 = viewXToTime(v, x);
      draftRef.current.p2 = viewYToPrice(v, y);
    }
    drawOverlay();
  };
  const onPointerUp = () => {
    const d = draftRef.current;
    draftRef.current = null;
    if (d && (d.t1 !== d.t2 || d.p1 !== d.p2)) {
      setDrawings((prev) => [...prev, { ...d, id: Date.now() + prev.length }]);
    }
    drawOverlay();
  };
  const onPointerLeave = () => {
    hoverRef.current = null;
    drawOverlay();
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
          const rows = unpackRows(saved.buf);
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
          session: setSession, speed: setSpeed, showSessions: setShowSessions
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
            contracts, pointValue, commission, dailyLimit, session, speed, showSessions
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
  }, [ready, pos, tf, tzMode, drawings, sessionTrades, position, visible, slPts, tpPts, contracts, pointValue, commission, dailyLimit, session, speed, showSessions]);

  const forgetSaved = async () => {
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
    <div className="space-y-4">
      {/* CARGA DE DATOS */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3 text-xs font-mono">
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {allowed.map((x) => (
                  <button
                    key={x.sec}
                    onClick={() => setTf(x.sec)}
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
              <span className="text-xs font-mono text-slate-400">
                {fmtTime(data[pos].t)} - {data[pos].c.toFixed(2)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
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
                onClick={() => setPan((p) => Math.min(p + Math.ceil(visible / 4), Math.max(0, agg.length - 1)))}
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
              <span className="text-[10px] font-mono text-slate-500 ml-1">{visible} velas</span>
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

            <div className="flex flex-wrap items-center gap-1.5">
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
                onClick={() => setDrawings([])}
                disabled={!drawings.length}
                className={`${btn} bg-slate-950 text-rose-400 border-rose-500/30 hover:text-rose-300 disabled:opacity-40`}
              >
                Borrar todo ({drawings.length})
              </button>
              {[
                ['line', 'Líneas'],
                ['rect', 'Rectángulos'],
                ['fib', 'Fib']
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setDrawings((prev) => prev.filter((d) => d.type !== id))}
                  disabled={!count(id)}
                  className={`${btn} bg-slate-950 text-slate-400 border-slate-800 hover:text-white disabled:opacity-40`}
                >
                  Borrar {label.toLowerCase()} ({count(id)})
                </button>
              ))}
            </div>

            {showSessions && (
              <div className="flex flex-wrap gap-3 text-[10px] font-mono">
                {SESSIONS.map((x) => (
                  <span key={x.id} style={{ color: x.color }}>
                    ■ {x.label} {x.start}-{x.end} ET
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <canvas ref={canvasRef} width={900} height={400} className="w-full h-auto rounded-lg bg-slate-950" />
              <canvas
                ref={overlayRef}
                width={900}
                height={400}
                className="absolute inset-0 w-full h-full"
                style={{ cursor: tool === 'cursor' ? 'default' : 'crosshair', touchAction: tool === 'cursor' ? 'auto' : 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerLeave}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

            <div>
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
                className="w-full accent-emerald-500 disabled:opacity-40"
              />
              <p className="text-[10px] font-mono text-slate-500">
                {position ? 'Cierra la operación para mover el punto de inicio.' : 'Arrastra para elegir desde dónde empezar.'}
              </p>
            </div>
          </div>

          {/* OPERATIVA */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
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
                  disabled={atEnd || limitHit}
                  className={`${btn} flex-1 bg-emerald-500 text-slate-950 border-emerald-400 font-bold disabled:opacity-40`}
                >
                  Comprar (BUY)
                </button>
                <button
                  onClick={() => openPosition('SELL')}
                  disabled={atEnd || limitHit}
                  className={`${btn} flex-1 bg-rose-500 text-slate-950 border-rose-400 font-bold disabled:opacity-40`}
                >
                  Vender (SELL)
                </button>
              </div>
            )}
          </div>

          {/* ESTADÍSTICAS EN VIVO */}
          {stats.n > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
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
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
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

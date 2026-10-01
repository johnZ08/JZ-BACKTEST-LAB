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
    const p = lines[i].split(sep).map((x) => x.replace(/"/g, '').trim());
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
  const [tzMode, setTzMode] = useState('server7'); // zona horaria de las horas del CSV
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [position, setPosition] = useState(null);
  const [sessionTrades, setSessionTrades] = useState([]);
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
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
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      loadData(parseCsv(await file.text()), file.name);
    } catch (err) {
      setError(err.message);
    }
    e.target.value = '';
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
    onSave(sessionTrades);
    setSessionTrades([]);
  };

  // Dibujo del gráfico de velas
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || visibleCandles.length === 0) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const padR = 84;
    const padY = 16;
    ctx.clearRect(0, 0, W, H);

    let lo = Math.min(...visibleCandles.map((c) => c.l));
    let hi = Math.max(...visibleCandles.map((c) => c.h));
    if (position) {
      lo = Math.min(lo, position.sl, position.tp);
      hi = Math.max(hi, position.sl, position.tp);
    }
    const margin = (hi - lo || 1) * 0.06;
    lo -= margin;
    hi += margin;
    const y = (p) => padY + ((hi - p) / (hi - lo)) * (H - padY * 2);
    const cw = (W - padR) / visible;

    if (showSessions) {
      const vc = visibleCandles;
      const left = (visible - vc.length) * cw;
      const plotW = W - padR;
      // tiempo -> x: posición fraccionaria dentro de la vela (los huecos del fin de semana se colapsan)
      const timeToX = (T) => {
        if (T <= vc[0].t) return left;
        let lo = 0;
        let hi = vc.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (vc[mid].t <= T) lo = mid;
          else hi = mid - 1;
        }
        return left + (lo + Math.min(1, (T - vc[lo].t) / tf)) * cw;
      };
      const tFrom = vc[0].t;
      const tTo = vc[vc.length - 1].t + tf;
      sessionIntervals(tFrom, tTo, tzMode).forEach(({ s, from, to }) => {
        if (to <= tFrom || from >= tTo) return;
        const x1 = Math.max(left, timeToX(from));
        const x2 = Math.min(plotW, timeToX(to));
        if (x2 - x1 < 1) return;
        ctx.fillStyle = hexToRgba(s.color, SESSION_ALPHA);
        ctx.fillRect(x1, 0, x2 - x1, H);
        if (x2 - x1 > 46) {
          ctx.font = '10px monospace';
          ctx.fillStyle = hexToRgba(s.color, 0.75);
          ctx.fillText(s.label, x1 + 4, H - 6);
        }
      });
    }

    ctx.font = '11px monospace';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const p = lo + ((hi - lo) * i) / 4;
      ctx.strokeStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(0, y(p));
      ctx.lineTo(W - padR, y(p));
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(p.toFixed(1), W - padR + 6, y(p) + 4);
    }

    const offset = (visible - visibleCandles.length) * cw;
    visibleCandles.forEach((c, i) => {
      const x = offset + i * cw + cw / 2;
      const color = c.c >= c.o ? '#10b981' : '#f43f5e';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.stroke();
      ctx.fillRect(x - cw * 0.35, y(Math.max(c.o, c.c)), cw * 0.7, Math.max(1, Math.abs(y(c.o) - y(c.c))));
    });

    const hline = (p, color, label) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y(p));
      ctx.lineTo(W - padR, y(p));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`${label} ${p.toFixed(1)}`.trim(), W - padR + 6, y(p) - 3);
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
      ctx.font = '11px monospace';
    }
    hline(visibleCandles[visibleCandles.length - 1].c, '#38bdf8', '');
  }, [visibleCandles, position, floatPts, floatUSD, visible, showSessions, tzMode, tf]);

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

            {showSessions && (
              <div className="flex flex-wrap gap-3 text-[10px] font-mono">
                {SESSIONS.map((x) => (
                  <span key={x.id} style={{ color: x.color }}>
                    ■ {x.label} {x.start}-{x.end} ET
                  </span>
                ))}
              </div>
            )}

            <canvas ref={canvasRef} width={900} height={400} className="w-full h-auto rounded-lg bg-slate-950" />

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

import React, { useState, useEffect, useMemo, useRef } from 'react';

// Desfase en horas para alinear las velas de 1h/4h con tu broker (prueba 0, 1, 2, 3...)
const ALIGN_OFFSET_H = 0;
const VISIBLE = 100; // velas visibles en pantalla
const SPEEDS = [1, 2, 5, 10, 20]; // velas base por segundo
const TIMEFRAMES = [
  { sec: 30, label: '30s' },
  { sec: 60, label: '1m' },
  { sec: 120, label: '2m' },
  { sec: 180, label: '3m' },
  { sec: 300, label: '5m' },
  { sec: 900, label: '15m' },
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

// Datos simulados solo para probar el replay (NO sirven para evaluar estrategias)
const genSample = () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  let price = 18000;
  const start = Date.UTC(2025, 0, 6, 0, 0) / 1000;
  for (let i = 0; i < 1440 * 5; i++) {
    const o = price;
    const c = o + (rnd() - 0.5) * 6;
    out.push({ t: start + i * 60, o, h: Math.max(o, c) + rnd() * 3, l: Math.min(o, c) - rnd() * 3, c });
    price = c;
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

export default function Replay({ onSave }) {
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
    const list = agg.slice(Math.max(0, i - VISIBLE + 1), i + 1);
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
    return list;
  }, [agg, pos, data]);

  const loadData = (rows, name) => {
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
    const risk = Math.abs(p.entry - p.sl);
    const rr = round2(Math.abs(p.tp - p.entry) / risk);
    const day = new Date(p.openTime * 1000).toISOString().slice(0, 10);
    const [y, m, d] = day.split('-');
    setSessionTrades((prev) => [
      ...prev,
      {
        id: Date.now() + prev.length,
        dateISO: day,
        date: `${d}/${m}/${y}`,
        monthKey: `${y}-${m}`,
        asset: 'NAS100',
        type: p.type,
        outcome,
        entry: p.entry,
        sl: p.sl,
        tp: p.tp,
        rr,
        resultR: round2(r),
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
          const rr = Math.abs(position.tp - position.entry) / Math.abs(position.entry - position.sl);
          closePosition(slHit ? 'LOSS' : 'WIN', slHit ? -1 : rr, p);
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

  const nextCandle = () => {
    if (!agg.length) return;
    const i = findAggIndex(agg, pos);
    const target = agg[i].lastIdx > pos ? agg[i].lastIdx : agg[Math.min(i + 1, agg.length - 1)].lastIdx;
    stepRef.current(target - pos);
  };

  const openPosition = (type) => {
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
      session
    });
    setError('');
  };

  const floatR = position
    ? ((position.type === 'BUY' ? 1 : -1) * (data[pos].c - position.entry)) /
      Math.abs(position.entry - position.sl)
    : 0;

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
    const cw = (W - padR) / VISIBLE;

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

    const offset = (VISIBLE - visibleCandles.length) * cw;
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
    }
    hline(visibleCandles[visibleCandles.length - 1].c, '#38bdf8', '');
  }, [visibleCandles, position]);

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
          onClick={() => loadData(genSample(), 'datos-simulados (1m)')}
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
            <div className="grid grid-cols-3 gap-3">
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
            </div>

            {position ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                <span className="text-slate-300">
                  {position.type} en {position.entry} - SL {position.sl} - TP {position.tp}
                </span>
                <span className={floatR >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {floatR >= 0 ? '+' : ''}
                  {floatR.toFixed(2)}R
                </span>
                <button onClick={closeAtMarket} className={`${btn} bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700`}>
                  Cerrar a mercado
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => openPosition('BUY')}
                  disabled={atEnd}
                  className={`${btn} flex-1 bg-emerald-500 text-slate-950 border-emerald-400 font-bold disabled:opacity-40`}
                >
                  Comprar (BUY)
                </button>
                <button
                  onClick={() => openPosition('SELL')}
                  disabled={atEnd}
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
                      {t.resultR > 0 ? '+' : ''}
                      {t.resultR}R
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

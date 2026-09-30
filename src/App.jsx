import React, { useState, useEffect } from 'react';
import Replay from './Replay.jsx';

export default function App() {
  const [trades, setTrades] = useState(() => {
    try {
      const saved = localStorage.getItem('jz_backtest_trades');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedSession, setSelectedSession] = useState('ALL');
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const [isAllTime, setIsAllTime] = useState(false);

  const [type, setType] = useState('BUY');
  const [outcome, setOutcome] = useState('WIN');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [formError, setFormError] = useState('');
  const [session, setSession] = useState('NY');
  const [notes, setNotes] = useState('');

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Define VITE_JZ_PIN en tu archivo .env para cambiar el PIN sin tocar el código
  const SECURE_PIN = import.meta.env.VITE_JZ_PIN || '0801';

  // Fecha del trade (la del backtest, no la de hoy): clave para estilo "replay"
  const [tradeDate, setTradeDate] = useState(() => new Date().toLocaleDateString('en-CA'));

  useEffect(() => {
    localStorage.setItem('jz_backtest_trades', JSON.stringify(trades));
  }, [trades]);

  const handlePrevMonth = () => {
    setIsAllTime(false);
    setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setIsAllTime(false);
    setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const currentMonthKey = `${currentMonthDate.getFullYear()}-${String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = currentMonthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  const requestAuthorization = (actionCallback) => {
    setPendingAction(() => actionCallback);
    setPinInput('');
    setAuthError(false);
    setShowPinModal(true);
  };

  const handleVerifyPin = (e) => {
    e.preventDefault();
    if (pinInput === SECURE_PIN) {
      setShowPinModal(false);
      setAuthError(false);
      if (pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
    } else {
      setAuthError(true);
      setPinInput('');
    }
  };

  const entryN = parseFloat(entry);
  const slN = parseFloat(sl);
  const tpN = parseFloat(tp);
  const hasLevels = [entryN, slN, tpN].every(Number.isFinite);

  const getLevelsError = () => {
    if (!hasLevels) return 'Completa entrada, stop loss y take profit.';
    if (type === 'BUY' && !(slN < entryN && entryN < tpN)) return 'En BUY debe cumplirse: SL < Entrada < TP.';
    if (type === 'SELL' && !(tpN < entryN && entryN < slN)) return 'En SELL debe cumplirse: TP < Entrada < SL.';
    return '';
  };

  const riskPoints = hasLevels ? Math.abs(entryN - slN) : 0;
  const rewardPoints = hasLevels ? Math.abs(tpN - entryN) : 0;
  const calculatedRR = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  const levelsMessage = formError || (entry && sl && tp ? getLevelsError() : '');

  const handleAddTradeSubmit = (e) => {
    e.preventDefault();
    const err = getLevelsError();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError('');
    const parsedRR = parseFloat(calculatedRR.toFixed(2));
    requestAuthorization(() => {
      const finalReturn = outcome === 'WIN' ? parsedRR : outcome === 'LOSS' ? -1 : 0;
      const [y, m, d] = tradeDate.split('-');

      const newTrade = {
        id: Date.now(),
        dateISO: tradeDate,
        date: `${d}/${m}/${y}`,
        monthKey: `${y}-${m}`,
        asset: 'NAS100',
        type,
        outcome,
        entry: entryN,
        sl: slN,
        tp: tpN,
        rr: parsedRR,
        resultR: finalReturn,
        session,
        notes
      };

      setTrades(prev => [...prev, newTrade]);
      setNotes('');
      setEntry('');
      setSl('');
      setTp('');
    });
  };

  const [view, setView] = useState('registro');

  const handleSaveReplayTrades = (list) => {
    requestAuthorization(() => {
      setTrades(prev => [...prev, ...list]);
    });
  };

  const handleDeleteTrade = (id) => {
    requestAuthorization(() => {
      setTrades(prev => prev.filter(t => t.id !== id));
    });
  };

  const handleClearAll = () => {
    requestAuthorization(() => {
      if (window.confirm('¿Seguro que deseas borrar todos los registros de la base de datos?')) {
        setTrades([]);
      }
    });
  };

  const filteredTrades = trades.filter(t => {
    const tMonthKey = t.monthKey || currentMonthKey;
    const matchesMonth = isAllTime ? true : tMonthKey === currentMonthKey;
    const matchesSession = selectedSession === 'ALL' ? true : t.session === selectedSession;
    return matchesMonth && matchesSession;
  }).sort((a, b) => (a.dateISO || '').localeCompare(b.dateISO || '') || a.id - b.id);

  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(t => t.outcome === 'WIN').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalR = filteredTrades.reduce((acc, t) => acc + t.resultR, 0).toFixed(2);
  const expectancy = totalTrades > 0 ? (parseFloat(totalR) / totalTrades).toFixed(2) : '0.00';

  const buyTrades = filteredTrades.filter(t => t.type === 'BUY');
  const buyWins = buyTrades.filter(t => t.outcome === 'WIN').length;
  const buyWinRate = buyTrades.length > 0 ? ((buyWins / buyTrades.length) * 100).toFixed(0) : '0';

  const sellTrades = filteredTrades.filter(t => t.type === 'SELL');
  const sellWins = sellTrades.filter(t => t.outcome === 'WIN').length;
  const sellWinRate = sellTrades.length > 0 ? ((sellWins / sellTrades.length) * 100).toFixed(0) : '0';

  const winningTradesList = filteredTrades.filter(t => t.resultR > 0);
  const losingTradesList = filteredTrades.filter(t => t.resultR < 0);
  const avgWinR = winningTradesList.length > 0 ? (winningTradesList.reduce((acc, t) => acc + t.resultR, 0) / winningTradesList.length).toFixed(2) : '0.00';
  const avgLossR = losingTradesList.length > 0 ? (Math.abs(losingTradesList.reduce((acc, t) => acc + t.resultR, 0)) / losingTradesList.length).toFixed(2) : '0.00';

  const grossWin = winningTradesList.reduce((acc, t) => acc + t.resultR, 0);
  const grossLoss = Math.abs(losingTradesList.reduce((acc, t) => acc + t.resultR, 0));
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? '∞' : '0.00';

  const handleExportCsv = () => {
    const header = ['Fecha', 'Activo', 'Tipo', 'Sesion', 'Resultado', 'Entrada', 'SL', 'TP', 'RR', 'Retorno_R', 'Notas'];
    const rows = filteredTrades.map(t => [
      t.date, t.asset, t.type, t.session, t.outcome, t.entry ?? '', t.sl ?? '', t.tp ?? '', t.rr, t.resultR,
      `"${(t.notes || '').replace(/"/g, '""')}"`
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jz-backtest-${isAllTime ? 'historial' : currentMonthKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  let currentStreak = 0;
  let streakType = 'NONE';
  if (filteredTrades.length > 0) {
    const lastOutcome = filteredTrades[filteredTrades.length - 1].outcome;
    streakType = lastOutcome;
    for (let i = filteredTrades.length - 1; i >= 0; i--) {
      if (filteredTrades[i].outcome === lastOutcome) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  const uniqueDaysOperated = new Set(filteredTrades.map(t => t.date)).size;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityData = [{ tradeNum: 0, R: 0, label: 'Inicio' }];

  filteredTrades.forEach((t, index) => {
    cumulative += t.resultR;
    if (cumulative > peak) peak = cumulative;
    const currentDrawdown = peak - cumulative;
    if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

    equityData.push({
      tradeNum: index + 1,
      R: parseFloat(cumulative.toFixed(2)),
      label: `#${index + 1}`
    });
  });

  const formattedMaxDD = maxDrawdown.toFixed(2);

  const svgWidth = 800;
  const svgHeight = 220;
  const padding = 40;
  const minR = Math.min(0, ...equityData.map(d => d.R));
  const maxR = Math.max(5, ...equityData.map(d => d.R));
  const rangeR = maxR - minR || 1;

  const getX = (index) => {
    if (equityData.length <= 1) return padding;
    return padding + (index / (equityData.length - 1)) * (svgWidth - padding * 2);
  };

  const getY = (val) => {
    return svgHeight - padding - ((val - minR) / rangeR) * (svgHeight - padding * 2);
  };

  const points = equityData.map((d, i) => `${getX(i)},${getY(d.R)}`).join(' ');
  const zeroY = getY(0);

  const totalRNum = parseFloat(totalR);
  const expectancyNum = parseFloat(expectancy);

  const sessionOptions = [
    { id: 'ALL', label: 'Todas' },
    { id: 'NY', label: 'NY' },
    { id: 'LONDON', label: 'Londres' },
    { id: 'ASIA', label: 'Asia' }
  ];

  const inputClass =
    'w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono transition';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-4 md:p-8">
      {/* MODAL DE PIN */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <form
            onSubmit={handleVerifyPin}
            className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4"
          >
            <div className="text-center space-y-1">
              <h3 className="text-lg font-bold text-white">Acción Protegida</h3>
              <p className="text-sm text-slate-300">Ingresa PIN de Autorización</p>
              <p className="text-xs text-slate-500">
                Se requiere autenticación para alterar los registros del Nasdaq.
              </p>
            </div>

            <input
              type="password"
              inputMode="numeric"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-center text-2xl tracking-widest text-white focus:outline-none focus:border-emerald-500 font-mono transition"
              autoFocus
              required
            />

            {authError && (
              <p className="text-center text-xs text-rose-400 font-mono">
                PIN incorrecto. Acceso denegado.
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPinModal(false)}
                className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl transition text-xs font-mono cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="w-1/2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl transition text-xs font-mono cursor-pointer"
              >
                Autorizar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-6">
        {/* CABECERA */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div>
            <h1 className="text-xl font-bold text-white font-mono">
              JZ_BACKTEST_LAB <span className="text-emerald-400">NAS100</span>{' '}
              <span className="text-xs text-slate-500">UAT</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Laboratorio Institucional de Pruebas &amp; Análisis Estadístico
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-2">
            <div className="flex gap-1.5">
              {[
                { id: 'registro', label: 'Registro' },
                { id: 'replay', label: 'Replay' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                    view === tab.id
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <span className="text-xs font-mono text-slate-500">
              Visualización Libre • Escritura Protegida 🔒
            </span>
          </div>
        </header>

        {view === 'replay' && <Replay onSave={handleSaveReplayTrades} />}

        <div className={view === 'registro' ? 'space-y-6' : 'hidden'}>
        {/* PERIODO Y SESIONES */}
        <section className="flex flex-col lg:flex-row gap-4">
          <div className="flex items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 lg:w-1/2">
            <button
              onClick={handlePrevMonth}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              ‹
            </button>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Periodo Activo</p>
              <p className="text-sm font-bold text-white capitalize">
                {isAllTime ? 'Todo el Historial' : monthLabel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAllTime(!isAllTime)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition shadow-sm cursor-pointer ${
                  isAllTime
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                Todo
              </button>
              <button
                onClick={handleNextMonth}
                className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              >
                ›
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 lg:w-1/2 flex-wrap text-xs font-mono">
            <span className="text-slate-500 mr-1">Sesión:</span>
            {sessionOptions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSession(s.id)}
                className={`px-3.5 py-1.5 rounded-lg font-bold transition border shadow-sm cursor-pointer ${
                  selectedSession === s.id
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* MÉTRICAS */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Total Trades</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{totalTrades}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Win Rate Global</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{winRate}%</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Retorno Total (R)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${totalRNum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalRNum > 0 ? `+${totalR}` : totalR}R
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Expectativa (EV)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${expectancyNum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {expectancyNum > 0 ? `+${expectancy}` : expectancy}R
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Max Drawdown</p>
            <p className="text-2xl font-bold text-rose-400 font-mono mt-1">-{formattedMaxDD}R</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">WR Compras (BUY)</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{buyWinRate}%</p>
            <p className="text-[10px] text-slate-500 font-mono">{buyTrades.length} trades</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">WR Ventas (SELL)</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{sellWinRate}%</p>
            <p className="text-[10px] text-slate-500 font-mono">{sellTrades.length} trades</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Racha Actual</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">
              {currentStreak} <span className="text-sm text-slate-400">{streakType}</span>
            </p>
            <p className="text-[10px] text-slate-500 font-mono">Streak</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Días Operados</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{uniqueDaysOperated} Días</p>
            <p className="text-[10px] text-slate-500 font-mono">Constancia</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Promedio W / L</p>
            <p className="text-lg font-bold text-white font-mono mt-1">
              <span className="text-emerald-400">+{avgWinR}R</span> /{' '}
              <span className="text-rose-400">-{avgLossR}R</span>
            </p>
            <p className="text-[10px] text-slate-500 font-mono">R:R Med</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Profit Factor</p>
            <p className="text-2xl font-bold text-white font-mono mt-1">{profitFactor}</p>
            <p className="text-[10px] text-slate-500 font-mono">Ganancia / Pérdida</p>
          </div>
        </section>

        {/* CURVA DE EQUIDAD */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-white font-mono mb-1">
            Curva de Equidad Acumulada (NAS100)
          </h2>
          <p className="text-xs text-slate-500 font-mono mb-4 capitalize">
            {isAllTime ? 'Historial Completo' : monthLabel}{' '}
            {selectedSession !== 'ALL' && `(${selectedSession})`}
          </p>

          {filteredTrades.length === 0 ? (
            <div className="text-center text-xs text-slate-500 font-mono py-10">
              No hay operaciones de Nasdaq registradas para los filtros seleccionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto min-w-[500px]">
                <line
                  x1={padding}
                  y1={zeroY}
                  x2={svgWidth - padding}
                  y2={zeroY}
                  stroke="#334155"
                  strokeDasharray="4 4"
                />
                <text x={8} y={zeroY + 4} fill="#64748b" fontSize="10" fontFamily="monospace">
                  0R
                </text>
                <polyline
                  points={points}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {equityData.map((d, i) => (
                  <circle key={i} cx={getX(i)} cy={getY(d.R)} r="3.5" fill="#10b981">
                    <title>{`${d.label}: ${d.R}R`}</title>
                  </circle>
                ))}
              </svg>
            </div>
          )}
        </section>

        {/* FORMULARIO + HISTORIAL */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleAddTradeSubmit}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 lg:col-span-1 h-fit"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white font-mono">Registrar Ejecución</h2>
              <span className="text-[10px] text-slate-500 font-mono">PIN Requerido 🔒</span>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                Activo / Par
              </label>
              <input type="text" value="NAS100" disabled className={`${inputClass} opacity-60`} />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                Fecha del Trade (Backtest)
              </label>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                  Dirección
                </label>
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                  Resultado
                </label>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputClass}>
                  <option value="WIN">WIN</option>
                  <option value="LOSS">LOSS</option>
                  <option value="BE">BE</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                ['Entrada', entry, setEntry],
                ['Stop Loss', sl, setSl],
                ['Take Profit', tp, setTp]
              ].map(([label, value, setter]) => (
                <div key={label}>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                    {label}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={value}
                    onChange={(e) => {
                      setter(e.target.value);
                      setFormError('');
                    }}
                    className={inputClass}
                    required
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
              <span>Riesgo: {riskPoints.toFixed(1)} pts</span>
              <span>
                R:R: <span className="text-emerald-400 font-bold">{calculatedRR.toFixed(2)}</span>
              </span>
            </div>

            {levelsMessage && <p className="text-xs text-rose-400 font-mono">{levelsMessage}</p>}

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                Sesión
              </label>
              <select value={session} onChange={(e) => setSession(e.target.value)} className={inputClass}>
                <option value="NY">NY</option>
                <option value="LONDON">Londres</option>
                <option value="ASIA">Asia</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">
                Notas / Confluencias (FVG, Liquidez, etc.)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. FVG M5 llenado en sesión NY..."
                rows="2"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl transition text-xs font-mono cursor-pointer"
            >
              Agregar Operación
            </button>
          </form>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-white font-mono capitalize">
                Historial {isAllTime ? 'Completo' : `de ${monthLabel}`}
              </h2>
              <div className="flex items-center gap-2">
                {filteredTrades.length > 0 && (
                  <button
                    onClick={handleExportCsv}
                    className="text-xs font-mono text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-lg px-3 py-1.5 transition cursor-pointer"
                  >
                    Exportar CSV
                  </button>
                )}
                {trades.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    className="text-xs font-mono text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-lg px-3 py-1.5 transition cursor-pointer"
                  >
                    Vaciar Registro 🔒
                  </button>
                )}
              </div>
            </div>

            {filteredTrades.length === 0 ? (
              <div className="text-center text-xs text-slate-500 font-mono py-10">
                No hay ejecuciones de Nasdaq registradas en este periodo.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Fecha</th>
                      <th className="py-2 pr-3">Activo</th>
                      <th className="py-2 pr-3">Tipo</th>
                      <th className="py-2 pr-3">Sesión</th>
                      <th className="py-2 pr-3">Resultado</th>
                      <th className="py-2 pr-3">Retorno R</th>
                      <th className="py-2 pr-3">Entrada / SL / TP</th>
                      <th className="py-2 pr-3">R:R</th>
                      <th className="py-2 pr-3">Notas</th>
                      <th className="py-2 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((t, idx) => (
                      <tr key={t.id} className="border-b border-slate-800/60 hover:bg-slate-950/50">
                        <td className="py-2 pr-3 text-slate-500">#{idx + 1}</td>
                        <td className="py-2 pr-3">{t.date}</td>
                        <td className="py-2 pr-3">{t.asset}</td>
                        <td className={`py-2 pr-3 font-bold ${t.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.type}
                        </td>
                        <td className="py-2 pr-3">{t.session}</td>
                        <td className="py-2 pr-3">{t.outcome}</td>
                        <td
                          className={`py-2 pr-3 font-bold ${
                            t.resultR > 0 ? 'text-emerald-400' : t.resultR < 0 ? 'text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          {t.resultR > 0 ? `+${t.resultR}R` : `${t.resultR}R`}
                        </td>
                        <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                          {t.entry !== undefined ? `${t.entry} / ${t.sl} / ${t.tp}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-400">{t.rr ? t.rr.toFixed(2) : '—'}</td>
                        <td className="py-2 pr-3 text-slate-400 max-w-[200px] truncate" title={t.notes || ''}>
                          {t.notes || '—'}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleDeleteTrade(t.id)}
                            className="text-slate-500 hover:text-rose-400 px-2 py-1 transition cursor-pointer"
                            title="Eliminar (requiere autorización)"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

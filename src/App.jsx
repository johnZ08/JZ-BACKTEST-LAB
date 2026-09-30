import React, { useState, useEffect } from 'react';

export default function App() {
  // Cargar trades guardados
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('jz_backtest_trades');
    return saved ? JSON.parse(saved) : [];
  });

  // Estado del filtro de sesión
  const [selectedSession, setSelectedSession] = useState('ALL');

  // Estado del formulario
  const [asset, setAsset] = useState('NAS100');
  const [type, setType] = useState('BUY');
  const [outcome, setOutcome] = useState('WIN');
  const [rr, setRr] = useState('2');
  const [session, setSession] = useState('NY');
  const [notes, setNotes] = useState('');

  // Persistencia
  useEffect(() => {
    localStorage.setItem('jz_backtest_trades', JSON.stringify(trades));
  }, [trades]);

  // Agregar trade
  const handleAddTrade = (e) => {
    e.preventDefault();
    const parsedRR = parseFloat(rr) || 0;
    const finalReturn = outcome === 'WIN' ? parsedRR : outcome === 'LOSS' ? -1 : 0;

    const newTrade = {
      id: Date.now(),
      date: new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }),
      asset,
      type,
      outcome,
      rr: parsedRR,
      resultR: finalReturn,
      session,
      notes
    };

    setTrades([...trades, newTrade]);
    setNotes('');
  };

  // Eliminar trade
  const handleDeleteTrade = (id) => {
    setTrades(trades.filter(t => t.id !== id));
  };

  // Vaciar historial
  const handleClearAll = () => {
    if (confirm('¿Seguro que deseas borrar todos los registros?')) {
      setTrades([]);
    }
  };

  // -------------------------------------------------------------
  // FILTRADO DE TRADES SEGÚN LA SESIÓN SELECCIONADA
  // -------------------------------------------------------------
  const filteredTrades = selectedSession === 'ALL' 
    ? trades 
    : trades.filter(t => t.session === selectedSession);

  // -------------------------------------------------------------
  // CÁLCULOS ESTADÍSTICOS & MÉTRICAS (SOBRE FILTRADOS)
  // -------------------------------------------------------------
  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(t => t.outcome === 'WIN').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalR = filteredTrades.reduce((acc, t) => acc + t.resultR, 0).toFixed(2);

  // Expectativa Matemática por Trade
  const expectancy = totalTrades > 0 ? (parseFloat(totalR) / totalTrades).toFixed(2) : '0.00';

  // Curva de equidad y Max Drawdown (R)
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  const equityData = [{ tradeNum: 0, R: 0, label: 'Inicio' }];

  filteredTrades.forEach((t, index) => {
    cumulative += t.resultR;
    
    if (cumulative > peak) {
      peak = cumulative;
    }
    
    const currentDrawdown = peak - cumulative;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    equityData.push({
      tradeNum: index + 1,
      R: parseFloat(cumulative.toFixed(2)),
      label: `#${index + 1} (${t.asset})`
    });
  });

  const formattedMaxDD = maxDrawdown.toFixed(2);

  // Dimensiones para SVG
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-wider text-emerald-400">
            JZ_BACKTEST_LAB <span className="text-xs text-slate-500 font-mono">v1.3</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">Terminal de Pruebas & Análisis Estadístico</p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2.5 py-1 rounded">
            STATUS: ONLINE
          </span>
        </div>
      </header>

      {/* FILTROS POR SESIÓN */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider pl-1">
          Filtrar por Sesión:
        </span>
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          {[
            { id: 'ALL', label: 'Todas las Sesiones' },
            { id: 'NY', label: 'New York (NY)' },
            { id: 'LONDON', label: 'Londres' },
            { id: 'ASIA', label: 'Asia' }
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSession(s.id)}
              className={`px-3 py-1.5 rounded-lg font-bold transition border ${
                selectedSession === s.id
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-950/50'
                  : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tarjetas de Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">Total Trades</p>
          <p className="text-2xl font-bold font-mono text-white">{totalTrades}</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">Win Rate</p>
          <p className="text-2xl font-bold font-mono text-emerald-400">{winRate}%</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">Total Retorno (R)</p>
          <p className={`text-2xl font-bold font-mono ${parseFloat(totalR) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalR > 0 ? `+${totalR}` : totalR}R
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">Expectativa (EV)</p>
          <p className={`text-2xl font-bold font-mono ${parseFloat(expectancy) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {expectancy > 0 ? `+${expectancy}` : expectancy}R
          </p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl col-span-2 md:col-span-1">
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">Max Drawdown</p>
          <p className="text-2xl font-bold font-mono text-rose-400">
            -{formattedMaxDD}R
          </p>
        </div>
      </div>

      {/* GRÁFICO: CURVA DE EQUIDAD */}
      <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl mb-8">
        <h2 className="text-lg font-bold text-slate-200 mb-4 border-b border-slate-800 pb-2 flex items-center justify-between">
          <span>Curva de Equidad Acumulada (R)</span>
          <span className="text-xs font-mono font-normal text-slate-400">
            Filtro: {selectedSession === 'ALL' ? 'Global' : selectedSession}
          </span>
        </h2>

        {filteredTrades.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-500 font-mono text-sm border border-dashed border-slate-800 rounded-lg">
            No hay operaciones registradas para el filtro seleccionado.
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto min-w-[600px] font-mono text-[10px]">
              {/* Línea Base Zero */}
              <line
                x1={padding}
                y1={zeroY}
                x2={svgWidth - padding}
                y2={zeroY}
                stroke="#334155"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />
              <text x={padding - 5} y={zeroY + 3} fill="#64748b" textAnchor="end">0R</text>

              {/* Trazo de la Curva */}
              <polyline
                fill="none"
                stroke={parseFloat(totalR) >= 0 ? '#10b981' : '#f43f5e'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />

              {/* Nodos interactivos */}
              {equityData.map((d, i) => {
                const cx = getX(i);
                const cy = getY(d.R);
                return (
                  <g key={i} className="group cursor-pointer">
                    <circle
                      cx={cx}
                      cy={cy}
                      r="4"
                      className={d.R >= 0 ? 'fill-emerald-400 stroke-slate-950' : 'fill-rose-400 stroke-slate-950'}
                      strokeWidth="2"
                    />
                    <text
                      x={cx}
                      y={cy - 12}
                      fill="#e2e8f0"
                      textAnchor="middle"
                      className="opacity-0 group-hover:opacity-100 transition-opacity font-bold bg-slate-900"
                    >
                      {d.R > 0 ? `+${d.R}R` : `${d.R}R`}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulario */}
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl h-fit">
          <h2 className="text-lg font-bold text-slate-200 mb-4 border-b border-slate-800 pb-2">
            Registrar Ejecución
          </h2>
          <form onSubmit={handleAddTrade} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Activo / Par</label>
              <input
                type="text"
                value={asset}
                onChange={(e) => setAsset(e.target.value.toUpperCase())}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Dirección</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                >
                  <option value="BUY">BUY (Largo)</option>
                  <option value="SELL">SELL (Corto)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Resultado</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                >
                  <option value="WIN">WIN</option>
                  <option value="LOSS">LOSS</option>
                  <option value="BE">Break Even</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Ratio R:R Objetivo</label>
                <input
                  type="number"
                  step="0.1"
                  value={rr}
                  onChange={(e) => setRr(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Sesión</label>
                <select
                  value={session}
                  onChange={(e) => setSession(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                >
                  <option value="NY">New York</option>
                  <option value="ASIA">Asia</option>
                  <option value="LONDON">Londres</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Notas / Confluencias (FVG, Liquidez, etc.)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. FVG M5 llenado en sesión NY..."
                rows="2"
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
              ></textarea>
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-2.5 rounded transition text-sm font-mono mt-2"
            >
              + Agregar Operación
            </button>
          </form>
        </div>

        {/* Tabla de Historial (Muestra los trades filtrados) */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 p-6 rounded-xl">
          <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
            <h2 className="text-lg font-bold text-slate-200">
              Historial de Ejecuciones {selectedSession !== 'ALL' && `(${selectedSession})`}
            </h2>
            {trades.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-rose-400 hover:text-rose-300 font-mono underline"
              >
                Vaciar Registro
              </button>
            )}
          </div>

          {filteredTrades.length === 0 ? (
            <div className="text-center py-12 text-slate-500 font-mono text-sm">
              No hay ejecuciones registradas para la sesión activa.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-2">#</th>
                    <th className="py-2 px-2">Fecha</th>
                    <th className="py-2 px-2">Activo</th>
                    <th className="py-2 px-2">Tipo</th>
                    <th className="py-2 px-2">Sesión</th>
                    <th className="py-2 px-2">Resultado</th>
                    <th className="py-2 px-2">Retorno R</th>
                    <th className="py-2 px-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredTrades.map((t, idx) => (
                    <tr key={t.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-2 text-slate-500">#{idx + 1}</td>
                      <td className="py-2.5 px-2 text-slate-400">{t.date}</td>
                      <td className="py-2.5 px-2 font-bold text-white">{t.asset}</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.type === 'BUY' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
                          {t.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-slate-400">{t.session}</td>
                      <td className="py-2.5 px-2">
                        <span className={`font-bold ${t.outcome === 'WIN' ? 'text-emerald-400' : t.outcome === 'LOSS' ? 'text-rose-400' : 'text-amber-400'}`}>
                          {t.outcome}
                        </span>
                      </td>
                      <td className={`py-2.5 px-2 font-bold ${t.resultR > 0 ? 'text-emerald-400' : t.resultR < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                        {t.resultR > 0 ? `+${t.resultR}R` : `${t.resultR}R`}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          onClick={() => handleDeleteTrade(t.id)}
                          className="text-slate-500 hover:text-rose-400 px-1"
                          title="Eliminar"
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
      </div>
    </div>
  );
}

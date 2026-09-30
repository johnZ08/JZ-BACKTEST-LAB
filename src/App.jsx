import React, { useState, useEffect } from 'react';

export default function App() {
  // Cargar trades guardados desde el navegador
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('jz_backtest_trades');
    return saved ? JSON.parse(saved) : [];
  });

  // Estado del formulario para nueva entrada
  const [asset, setAsset] = useState('NAS100');
  const [type, setType] = useState('BUY');
  const [outcome, setOutcome] = useState('WIN');
  const [rr, setRr] = useState('2');
  const [session, setSession] = useState('NY');
  const [notes, setNotes] = useState('');

  // Guardar en localStorage cada vez que cambia la lista
  useEffect(() => {
    localStorage.setItem('jz_backtest_trades', JSON.stringify(trades));
  }, [trades]);

  // Agregar nuevo trade
  const handleAddTrade = (e) => {
    e.preventDefault();
    const parsedRR = parseFloat(rr) || 0;
    const finalReturn = outcome === 'WIN' ? parsedRR : outcome === 'LOSS' ? -1 : 0;

    const newTrade = {
      id: Date.now(),
      date: new Date().toLocaleDateString(),
      asset,
      type,
      outcome,
      rr: parsedRR,
      resultR: finalReturn,
      session,
      notes
    };

    setTrades([newTrade, ...trades]);
    setNotes('');
  };

  // Eliminar trade
  const handleDeleteTrade = (id) => {
    setTrades(trades.filter(t => t.id !== id));
  };

  // Limpiar todo el historial
  const handleClearAll = () => {
    if (confirm('¿Seguro que deseas borrar todos los registros?')) {
      setTrades([]);
    }
  };

  // Cálculos estadísticos automáticos
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalR = trades.reduce((acc, t) => acc + t.resultR, 0).toFixed(2);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-8 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-wider text-emerald-400">
            JZ_BACKTEST_LAB <span className="text-xs text-slate-500 font-mono">v1.0</span>
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

      {/* Tarjetas de Métricas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2">Total Trades</p>
          <p className="text-3xl font-bold font-mono text-white">{totalTrades}</p>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2">Win Rate</p>
          <p className="text-3xl font-bold font-mono text-emerald-400">{winRate}%</p>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-2">Total Retorno (R)</p>
          <p className={`text-3xl font-bold font-mono ${parseFloat(totalR) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalR}R
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulario de Registro */}
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

        {/* Tabla de Historial */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 p-6 rounded-xl">
          <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
            <h2 className="text-lg font-bold text-slate-200">Historial de Ejecuciones</h2>
            {trades.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-rose-400 hover:text-rose-300 font-mono underline"
              >
                Vaciar Registro
              </button>
            )}
          </div>

          {trades.length === 0 ? (
            <div className="text-center py-12 text-slate-500 font-mono text-sm">
              No hay ejecuciones registradas. Completa el formulario de la izquierda para agregar tu primer trade.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
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
                  {trades.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-800/30">
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

Import React, { useState } from 'react';

export default function App() {
  const [trades, setTrades] = useState([]);

  // Cálculos estadísticos básicos
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.result === 'WIN').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalReturn = trades.reduce((acc, t) => acc + (parseFloat(t.rMultiple) || 0), 0).toFixed(2);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Encabezado Terminal */}
        <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-emerald-400">
              JZ_BACKTEST_LAB <span className="text-xs text-slate-500 font-mono">v1.0</span>
            </h1>
            <p className="text-sm text-slate-400">Terminal de Pruebas & Análisis Estadístico</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded">
              STATUS: ONLINE
            </span>
          </div>
        </header>

        {/* Tarjetas de Métricas Estadísticas */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800/80 shadow-lg">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">TOTAL TRADES</span>
            <div className="text-3xl font-bold font-mono mt-1 text-slate-100">{totalTrades}</div>
          </div>

          <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800/80 shadow-lg">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">WIN RATE</span>
            <div className="text-3xl font-bold font-mono mt-1 text-emerald-400">{winRate}%</div>
          </div>

          <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-800/80 shadow-lg">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">TOTAL RETORNO (R)</span>
            <div className={`text-3xl font-bold font-mono mt-1 ${totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              {totalReturn > 0 ? `+${totalReturn}` : totalReturn}R
            </div>
          </div>
        </section>

        {/* Panel Principal */}
        <main className="bg-slate-900/40 p-6 rounded-xl border border-slate-800/80 text-center py-12">
          <p className="text-slate-400 text-sm">
            Laboratorio listo. Agrega tus ejecuciones para actualizar las métricas en tiempo real.
          </p>
        </main>

      </div>
    </div>
  );
}
 

Lo pegó aca

import React, { useState, useEffect } from 'react';

export default function App() {
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('jz_backtest_trades');
    return saved ? JSON.parse(saved) : [];
  });

  const [pair, setPair] = useState('NAS100');
  const [direction, setDirection] = useState('BUY');
  const [rr, setRr] = useState('2.0');
  const [outcome, setOutcome] = useState('WIN');
  const [confluence, setConfluence] = useState('FVG + FVG Inversion');

  useEffect(() => {
    localStorage.setItem('jz_backtest_trades', JSON.stringify(trades));
  }, [trades]);

  const addTrade = (e) => {
    e.preventDefault();
    const newTrade = {
      id: Date.now(),
      date: new Date().toLocaleDateString(),
      pair,
      direction,
      rr: parseFloat(rr),
      outcome,
      confluence,
      rMultiple: outcome === 'WIN' ? parseFloat(rr) : outcome === 'BE' ? 0 : -1
    };
    setTrades([newTrade, ...trades]);
  };

  const deleteTrade = (id) => {
    setTrades(trades.filter(t => t.id !== id));
  };

  // Métricas estadísticas
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const winRate = totalTrades ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalR = trades.reduce((acc, t) => acc + t.rMultiple, 0).toFixed(2);
  const expectancy = totalTrades ? (totalR / totalTrades).toFixed(2) : '0.00';

  return (
{/* Encabezado Terminal */}> JZ_BACKTEST_LAB_v1.0Terminal de Pruebas & Análisis EstadísticoSTATUS: ONLINE{/* Tarjetas de Métricas Estadísticas */}TOTAL TRADES
{totalTrades}WIN RATE
{winRate}%TOTAL RETORNO (R)
= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
{totalR}REXPECTATIVA (R)
{expectancy}R{/* Panel Principal: Formulario y Registro */}{/* Formulario de Entrada */}+ NUEVA ENTRADAActivo / Par
setPair(e.target.value)}
className="w-full bg-slate-950 border border-emerald-800/80 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-400"
required
/>DirecciónResultadoRatio R:R Plan
setRr(e.target.value)}
className="w-full bg-slate-950 border border-emerald-800/80 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-400"
required
/>Confluencia / Setup
setConfluence(e.target.value)}
className="w-full bg-slate-950 border border-emerald-800/80 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-400"
/>REGISTRAR TRADE{/* Tabla de Registros Deslizable */}LOGS DE OPERACIONES{trades.length === 0 ? () : (
trades.map((t) => ())
)}FECHAACTIVOTIPORESULTADORETORNOCONFLUENCIAACCIÓNNo hay registros grabados. Agrega un trade para iniciar.{t.date}{t.pair}{t.direction}{t.outcome}{t.rMultiple > 0 ? +\({t.rMultiple}R : \){t.rMultiple}R}{t.confluence}deleteTrade(t.id)}className="text-rose-500 hover:text-rose-400 text-xs px-2 py-1 rounded"[X]);
}

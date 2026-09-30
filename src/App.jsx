import React, { useState, useEffect } from 'react';

export default function App() {
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('jz_backtest_trades');
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedSession, setSelectedSession] = useState('ALL');
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const [isAllTime, setIsAllTime] = useState(false);

  const [type, setType] = useState('BUY');
  const [outcome, setOutcome] = useState('WIN');
  const [rr, setRr] = useState('2');
  const [session, setSession] = useState('NY');
  const [notes, setNotes] = useState('');

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const SECURE_PIN = '0801'; 

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

  const currentMonthKey = `\({currentMonthDate.getFullYear()}-\){String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
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

  const handleAddTradeSubmit = (e) => {
    e.preventDefault();
    requestAuthorization(() => {
      const parsedRR = parseFloat(rr) || 0;
      const finalReturn = outcome === 'WIN' ? parsedRR : outcome === 'LOSS' ? -1 : 0;
      const now = new Date();

      const newTrade = {
        id: Date.now(),
        date: now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        monthKey: `\({now.getFullYear()}-\){String(now.getMonth() + 1).padStart(2, '0')}`,
        asset: 'NAS100',
        type,
        outcome,
        rr: parsedRR,
        resultR: finalReturn,
        session,
        notes
      };

      setTrades(prev => [...prev, newTrade]);
      setNotes('');
    });
  };

  const handleDeleteTrade = (id) => {
    requestAuthorization(() => {
      setTrades(prev => prev.filter(t => t.id !== id));
    });
  };

  const handleClearAll = () => {
    requestAuthorization(() => {
      if (confirm('¿Seguro que deseas borrar todos los registros de la base de datos?')) {
        setTrades([]);
      }
    });
  };

  const filteredTrades = trades.filter(t => {
    const tMonthKey = t.monthKey || currentMonthKey;
    const matchesMonth = isAllTime ? true : tMonthKey === currentMonthKey;
    const matchesSession = selectedSession === 'ALL' ? true : t.session === selectedSession;
    return matchesMonth && matchesSession;
  });

  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(t => t.outcome === 'WIN').length;
  const losses = filteredTrades.filter(t => t.outcome === 'LOSS').length;
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

  const points = equityData.map((d, i) => `\({getX(i)},\){getY(d.R)}`).join(' ');
  const zeroY = getY(0);

  return (
{showPinModal && (

Acción Protegida

Ingresa PIN de Autorización
Se requiere autenticación para alterar los registros del Nasdaq.

setPinInput(e.target.value)}
placeholder="••••"
className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-center text-2xl tracking-widest text-white focus:outline-none focus:border-emerald-500 font-mono transition"
autoFocus
required
/>

{authError && (

PIN incorrecto. Acceso denegado.

)}

setShowPinModal(false)}
className="w-1/2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl transition text-xs font-mono cursor-pointer"

Cancelar

Autorizar

)}

JZ_BACKTEST_LAB NAS100 UAT
Laboratorio Institucional de Pruebas & Análisis Estadístico

Visualización Libre • Escritura Protegida 🔒

‹

Periodo Activo

{isAllTime ? 'Todo el Historial' : monthLabel}

setIsAllTime(!isAllTime)}
className={px-3 py-1.5 rounded-lg text-xs font-mono border transition shadow-sm cursor-pointer ${ isAllTime  ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white' }}

Todo

›

Sesión:

{[
{ id: 'ALL', label: 'Todas' },
{ id: 'NY', label: 'NY' },
{ id: 'LONDON', label: 'Londres' },
{ id: 'ASIA', label: 'Asia' }
].map((s) => (
setSelectedSession(s.id)}
className={px-3.5 py-1.5 rounded-lg font-bold transition border shadow-sm cursor-pointer ${ selectedSession === s.id ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white' }}

{s.label}
))}

Total Trades

{totalTrades}

Win Rate Global

{winRate}%

Retorno Total (R)

= 0 ? 'text-emerald-400' : 'text-rose-400'}}> {totalR > 0 ? +${totalR}` : totalR}R

Expectativa (EV)

= 0 ? 'text-emerald-400' : 'text-rose-400'}}> {expectancy > 0 ? +${expectancy}` : expectancy}R

Max Drawdown

-{formattedMaxDD}R

WR Compras (BUY)
{buyWinRate}%

{buyTrades.length}

WR Ventas (SELL)
{sellWinRate}%

{sellTrades.length}

Racha Actual

{currentStreak} {streakType}

Streak

Días Operados
{uniqueDaysOperated} Días

Constancia

Promedio W / L
+{avgWinR}R / -{avgLossR}R

R:R Med

Curva de Equidad Acumulada (NAS100)
{isAllTime ? 'Historial Completo' : monthLabel} {selectedSession !== 'ALL' && (${selectedSession})}
{filteredTrades.length === 0 ? (

No hay operaciones de Nasdaq registradas para los filtros seleccionados.

) : (

SVG

Registrar Ejecución
PIN Requerido 🔒

Activo / Par

Dirección


BUY (Largo)

SELL (Corto)
Enviar
Resultado


WIN

LOSS

Break Even
Enviar
Ratio R:R Objetivo
setRr(e.target.value)}
className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono transition"
required
/>

Sesión


New York

Asia

Londres
Enviar
Notas / Confluencias (FVG, Liquidez, etc.)
setNotes(e.target.value)}
placeholder="Ej. FVG M5 llenado en sesión NY..."
rows="2"
className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 font-mono transition"

Agregar Operación
PIN 0801

Historial {isAllTime ? 'Completo' : de ${monthLabel}}
{trades.length > 0 && (

Vaciar Registro 🔒
)}

{filteredTrades.length === 0 ? (

No hay ejecuciones de Nasdaq registradas en este periodo.

) : (

{filteredTrades.map((t, idx) => (

))}

Fecha	Activo	Tipo	Sesión	Resultado	Retorno R	Acción
#{idx + 1}	{t.date}	{t.asset}	{t.type}	{t.session}	{t.outcome}	0 ? 'text-emerald-400' : t.resultR < 0 ? 'text-rose-400' : 'text-slate-400'}}> {t.resultR > 0 ?+t.resultRR‘:‘{t.resultR}R`}	
handleDeleteTrade(t.id)} className="text-slate-500 hover:text-rose-400 px-2 py-1 transition cursor-pointer" title="Eliminar (Requiere PIN 0801)"

✕

)}

);
}

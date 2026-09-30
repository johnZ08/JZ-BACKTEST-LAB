import React, { useState, useEffect } from 'react';

export default function App() {
  // Cargar trades guardados
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('jz_backtest_trades');
    return saved ? JSON.parse(saved) : [];
  });

  // Estado del filtro de sesión
  const [selectedSession, setSelectedSession] = useState('ALL');

  // Estado del mes activo para el navegador tipo calendario (Format YYYY-MM)
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const [isAllTime, setIsAllTime] = useState(false);

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

  // Funciones de navegación tipo Calendario
  const handlePrevMonth = () => {
    setIsAllTime(false);
    setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setIsAllTime(false);
    setCurrentMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Formatear mes visible (Ej. "Septiembre 2026")
  const currentMonthKey = `\({currentMonthDate.getFullYear()}-\){String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = currentMonthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  // Agregar trade
  const handleAddTrade = (e) => {
    e.preventDefault();
    const parsedRR = parseFloat(rr) || 0;
    const finalReturn = outcome === 'WIN' ? parsedRR : outcome === 'LOSS' ? -1 : 0;
    const now = new Date();

    const newTrade = {
      id: Date.now(),
      date: now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      monthKey: `\({now.getFullYear()}-\){String(now.getMonth() + 1).padStart(2, '0')}`,
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
    if (confirm('¿Seguro que deseas borrar todos los registros de la base de datos?')) {
      setTrades([]);
    }
  };

  // -------------------------------------------------------------
  // FILTRADO DUAL: POR MES Y POR SESIÓN
  // -------------------------------------------------------------
  const filteredTrades = trades.filter(t => {
    const tMonthKey = t.monthKey || currentMonthKey;
    const matchesMonth = isAllTime ? true : tMonthKey === currentMonthKey;
    const matchesSession = selectedSession === 'ALL' ? true : t.session === selectedSession;
    return matchesMonth && matchesSession;
  });

  // -------------------------------------------------------------
  // CÁLCULOS ESTADÍSTICOS & MÉTRICAS AVANZADAS
  // -------------------------------------------------------------
  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(t => t.outcome === 'WIN').length;
  const losses = filteredTrades.filter(t => t.outcome === 'LOSS').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalR = filteredTrades.reduce((acc, t) => acc + t.resultR, 0).toFixed(2);

  // Expectativa Matemática (EV)
  const expectancy = totalTrades > 0 ? (parseFloat(totalR) / totalTrades).toFixed(2) : '0.00';

  // Métricas por Tipo (BUY vs SELL)
  const buyTrades = filteredTrades.filter(t => t.type === 'BUY');
  const buyWins = buyTrades.filter(t => t.outcome === 'WIN').length;
  const buyWinRate = buyTrades.length > 0 ? ((buyWins / buyTrades.length) * 100).toFixed(0) : '0';

  const sellTrades = filteredTrades.filter(t => t.type === 'SELL');
  const sellWins = sellTrades.filter(t => t.outcome === 'WIN').length;
  const sellWinRate = sellTrades.length > 0 ? ((sellWins / sellTrades.length) * 100).toFixed(0) : '0';

  // Promedio de R por ganador y perdedor
  const winningTradesList = filteredTrades.filter(t => t.resultR > 0);
  const losingTradesList = filteredTrades.filter(t => t.resultR < 0);
  const avgWinR = winningTradesList.length > 0 ? (winningTradesList.reduce((acc, t) => acc + t.resultR, 0) / winningTradesList.length).toFixed(2) : '0.00';
  const avgLossR = losingTradesList.length > 0 ? (Math.abs(losingTradesList.reduce((acc, t) => acc + t.resultR, 0)) / losingTradesList.length).toFixed(2) : '0.00';

  // Curva de equidad y Max Drawdown (R)
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
      label: `#\({index + 1} (\){t.asset})`
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

  const points = equityData.map((d, i) => `\({getX(i)},\){getY(d.R)}`).join(' ');
  const zeroY = getY(0);

  return (

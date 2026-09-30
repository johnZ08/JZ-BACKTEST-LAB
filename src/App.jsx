import React, { useState, useEffect } from 'react';

export default function App() {
  // -------------------------------------------------------------
  // ESTADOS PRINCIPALES DE DATOS
  // -------------------------------------------------------------
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('jz_backtest_trades');
    return saved ? JSON.parse(saved) : [];
  });

  // Estados de filtros (Solo Sesión, enfocado en Nasdaq)
  const [selectedSession, setSelectedSession] = useState('ALL');

  // Estado del mes activo para el navegador tipo calendario
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const [isAllTime, setIsAllTime] = useState(false);

  // Estados del formulario
  const [type, setType] = useState('BUY');
  const [outcome, setOutcome] = useState('WIN');
  const [rr, setRr] = useState('2');
  const [session, setSession] = useState('NY');
  const [notes, setNotes] = useState('');

  // -------------------------------------------------------------
  // ESTADOS DE SEGURIDAD (MODAL DE PIN PARA ESCRITURA)
  // -------------------------------------------------------------
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // Guarda la acción que intentaba hacer

  // PIN de seguridad solicitado
  const SECURE_PIN = '0801'; 

  // Persistencia de trades
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

  const currentMonthKey = `\({currentMonthDate.getFullYear()}-\){String(currentMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const monthLabel = currentMonthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  // -------------------------------------------------------------
  // CONTROL DE AUTORIZACIÓN (INTERCEPTOR DE ESCRITURA)
  // -------------------------------------------------------------
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
        pendingAction(); // Ejecuta la acción que estaba bloqueada
        setPendingAction(null);
      }
    } else {
      setAuthError(true);
      setPinInput('');
    }
  };

  // -------------------------------------------------------------
  // ACCIONES PROTEGIDAS DE ESCRITURA
  // -------------------------------------------------------------
  const handleAddTradeSubmit = (e) => {
    e.preventDefault();
    
    // Interceptamos con PIN antes de agregar
    requestAuthorization(() => {
      const parsedRR = parseFloat(rr) || 0;
      const finalReturn = outcome === 'WIN' ? parsedRR : outcome === 'LOSS' ? -1 : 0;
      const now = new Date();

      const newTrade = {
        id: Date.now(),
        date: now.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        monthKey: `\({now.getFullYear()}-\){String(now.getMonth() + 1).padStart(2, '0')}`,
        asset: 'NAS100', // Fijo en Nasdaq
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

  // -------------------------------------------------------------
  // FILTRADO (SOLO MES Y SESIÓN - NAS100 BASE)
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

  // Promedios R
  const winningTradesList = filteredTrades.filter(t => t.resultR > 0);
  const losingTradesList = filteredTrades.filter(t => t.resultR < 0);
  const avgWinR = winningTradesList.length > 0 ? (winningTradesList.reduce((acc, t) => acc + t.resultR, 0) / winningTradesList.length).toFixed(2) : '0.00';
  const avgLossR = losingTradesList.length > 0 ? (Math.abs(losingTradesList.reduce((acc, t) => acc + t.resultR, 0)) / losingTradesList.length).toFixed(2) : '0.00';

  // Racha actual (Streak)
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

  // Días Únicos Operados (Constancia)
  const uniqueDaysOperated = new Set(filteredTrades.map(t => t.date)).size;

  // Curva de equidad y Max Drawdown
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

  // Dimensiones SVG
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

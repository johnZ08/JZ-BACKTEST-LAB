import React, { useState } from 'react';

export default function App() {
  const [trades, setTrades] = useState([]);

  // Cálculos estadísticos básicos
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.result === 'WIN').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalReturn = trades.reduce((acc, t) => acc + (parseFloat(t.rMultiple) || 0), 0).toFixed(2);

  return (
{/* Encabezado Terminal */}

JZ_BACKTEST_LAB v1.0
Terminal de Pruebas & Análisis Estadístico

STATUS: ONLINE

{/* Tarjetas de Métricas Estadísticas */}

TOTAL TRADES

{totalTrades}

WIN RATE

{winRate}%

TOTAL RETORNO (R)

= 0 ? 'text-emerald-400' : 'text-rose-500'}}> {totalReturn > 0 ? +${totalReturn}` : totalReturn}R

{/* Panel Principal */}

Laboratorio listo. Agrega tus ejecuciones para actualizar las métricas en tiempo real.

);
}

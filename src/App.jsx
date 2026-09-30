import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, BarChart2, PlusCircle, Download, Upload, Trash2, 
  CheckCircle, AlertCircle, Star, Filter, ArrowUpRight, ArrowDownRight, RefreshCw
} from 'lucide-react';

const INITIAL_TRADES = [
  {
    id: '1',
    pair: 'NAS100',
    date: '2026-09-15T10:30',
    session: 'New York (Killzone AM)',
    direction: 'Buy',
    slPips: 15,
    tpPips: 45,
    plannedRR: 3.0,
    actualR: 3.0,
    result: 'Win',
    confluences: ['Market Structure Shift (MSS)', 'Fair Value Gap (FVG)', 'Liquidity Sweep'],
    executionQuality: 5,
    imageUrl: 'https://tradingview.com',
    notes: 'Entrada limpia tras sweep de sesión de Asia y MSS en 1m.'
  },
  {
    id: '2',
    pair: 'EURUSD',
    date: '2026-09-16T08:15',
    session: 'London',
    direction: 'Sell',
    slPips: 8,
    tpPips: 24,
    plannedRR: 3.0,
    actualR: -1.0,
    result: 'Loss',
    confluences: ['Liquidity Sweep', 'Order Block (OB)'],
    executionQuality: 3,
    imageUrl: '',
    notes: 'Sacado por spread antes de la expansión.'
  }
];

export default function App() {
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem('backtest_trades');
    return saved ? JSON.parse(saved) : INITIAL_TRADES;
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterConfluence, setFilterConfluence] = useState('All');
  const [filterSession, setFilterSession] = useState('All');

  // Form State
  const [formData, setFormData] = useState({
    pair: 'NAS100',
    date: new Date().toISOString().slice(0, 16),
    session: 'New York (Killzone AM)',
    direction: 'Buy',
    slPips: 10,
    tpPips: 30,
    actualR: 3,
    result: 'Win',
    confluences: [],
    executionQuality: 5,
    imageUrl: '',
    notes: ''
  });

  useEffect(() => {
    localStorage.setItem('backtest_trades', JSON.stringify(trades));
  }, [trades]);

  const confluenceOptions = [
    'Market Structure Shift (MSS)',
    'Liquidity Sweep',
    'Fair Value Gap (FVG)',
    'Order Block (OB)',
    'Premium / Discount Zone',
    'Breaker Block',
    'Daily Bias Alignment',
    'OTE (Optimal Trade Entry)'
  ];

  // Filtering Logic
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const matchConfluence = filterConfluence === 'All' || t.confluences.includes(filterConfluence);
      const matchSession = filterSession === 'All' || t.session === filterSession;
      return matchConfluence && matchSession;
    });
  }, [trades, filterConfluence, filterSession]);

  // Analytics Calculation
  const stats = useMemo(() => {
    const totalTrades = filteredTrades.length;
    if (totalTrades === 0) return { totalR: 0, winRate: 0, expectancy: 0, profitFactor: 0, avgQuality: 0 };

    const wins = filteredTrades.filter(t => t.result === 'Win' || t.actualR > 0);
    const losses = filteredTrades.filter(t => t.result === 'Loss' || t.actualR < 0);

    const totalR = filteredTrades.reduce((acc, t) => acc + Number(t.actualR), 0);
    const winRate = (wins.length / totalTrades) * 100;

    const grossProfitR = wins.reduce((acc, t) => acc + Number(t.actualR), 0);
    const grossLossR = Math.abs(losses.reduce((acc, t) => acc + Number(t.actualR), 0));

    const avgWinR = wins.length > 0 ? grossProfitR / wins.length : 0;
    const avgLossR = losses.length > 0 ? grossLossR / losses.length : 1;

    const winProb = wins.length / totalTrades;
    const lossProb = losses.length / totalTrades;
    const expectancy = (winProb * avgWinR) - (lossProb * avgLossR);
    const profitFactor = grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR;

    const avgQuality = filteredTrades.reduce((acc, t) => acc + Number(t.executionQuality), 0) / totalTrades;

    return {
      totalR: totalR.toFixed(2),
      winRate: winRate.toFixed(1),
      expectancy: expectancy.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
      avgQuality: avgQuality.toFixed(1),
      winsCount: wins.length,
      lossesCount: losses.length
    };
  }, [filteredTrades]);

  // Equity Curve Points
  const equityCurve = useMemo(() => {
    let currentR = 0;
    return filteredTrades.map((t, idx) => {
      currentR += Number(t.actualR);
      return { tradeNumber: idx + 1, rAcc: currentR };
    });
  }, [filteredTrades]);

  const handleConfluenceToggle = (item) => {
    setFormData(prev => {
      const exists = prev.confluences.includes(item);
      return {
        ...prev,
        confluences: exists 
          ? prev.confluences.filter(c => c !== item)
          : [...prev.confluences, item]
      };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const plannedRR = formData.slPips > 0 ? (formData.tpPips / formData.slPips).toFixed(2) : 0;
    const newTrade = {
      ...formData,
      id: Date.now().toString(),
      plannedRR: Number(plannedRR),
      actualR: Number(formData.actualR)
    };

    setTrades([newTrade, ...trades]);
    setIsModalOpen(false);
  };

  const handleDelete = (id) => {
    if (confirm('¿Eliminar este ensayo de backtesting?')) {
      setTrades(trades.filter(t => t.id !== id));
    }
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(trades, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `Backtest_JZTrades_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImport = (e) => {
    const fileReader = new FileReader();
    fileReader.readAsText(e.target.files[0], "UTF-8");
    fileReader.onload = (e) => {
      try {
        const parsedData = JSON.parse(e.target.result);
        if (Array.isArray(parsedData)) {
          setTrades(parsedData);
          alert('¡Ensayos importados con éxito!');
        }
      } catch (err) {
        alert('Archivo JSON no válido.');
      }
    };
  };

  return (
{/* HEADER */}JZ BACKTEST LABPlataforma de Ensayo & Mapeo de Confluencias en $R$setIsModalOpen(true)}
className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-2.5 rounded-lg transition-all text-sm"Registrar EnsayoExportar JSONImportar{/* KPI DASHBOARD */}Retorno Total R= 0 ? 'text-emerald-400' : 'text-rose-500'}}> {stats.totalR > 0 ? +${stats.totalR}` : stats.totalR}R{filteredTrades.length} ensayos evaluadosWin Rate %{stats.winRate}%{stats.winsCount}W - {stats.lossesCount}LExpectativa ($R$/Trade)+{stats.expectancy}REsperanza matemáticaProfit Factor{stats.profitFactor}Ratio $R$ Ganado / PerdedorCalidad Ejecución{stats.avgQuality}Promedio de disciplina{/* CURVA DE EQUITY EN R */}Curva de Equidad Acumulada (en Unidades de R){equityCurve.map((pt, idx) => {
const height = Math.min(Math.max(Math.abs(pt.rAcc) * 10, 8), 100);
const isPositive = pt.rAcc >= 0;
return (Trade #{pt.tradeNumber}: {pt.rAcc > 0 ? +${pt.rAcc.toFixed(1)} : pt.rAcc.toFixed(1)}R);
})}{/* CONTROLES DE FILTRO */}Historial de Ensayos ({filteredTrades.length}){/* TABLA DE TRADES */}{filteredTrades.length === 0 ? () : (
filteredTrades.map((t) => ())
)}Par / FechaSesiónDirecciónR:R PlanR ObtenciónConfluencias MapeadasCalidadAccionesNo hay ensayos registrados con estos filtros.{t.pair}
{t.date.replace('T', ' ')}{t.session}{t.direction === 'Buy' ?  : }
{t.direction}1:{t.plannedRR}R0 ? 'bg-emerald-500/10 text-emerald-400' : t.actualR < 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-700 text-slate-300'}}> {t.actualR > 0 ? +${t.actualR}` : t.actualR}R{t.confluencias?.map((c, i) => ({c}
))}{t.executionQuality}★handleDelete(t.id)}className="text-slate-500 hover:text-rose-400 p-1 transition-colors"{/* MODAL NUEVO ENSAYO */}
{isModalOpen && (Registrar Nuevo Ensayo de BacktestPar / ActivoSesiónDirecciónSL (Pips)
setFormData({...formData, slPips: Number(e.target.value)})}
className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
/>TP (Pips)
setFormData({...formData, tpPips: Number(e.target.value)})}
className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
/>Resultado R Obtenido
setFormData({...formData, actualR: e.target.value})}
className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-bold"
placeholder="Ej: 3.5 o -1"
/>Calidad de Ejecución (1-5★)Confluencias ICT / Smart Money{confluenceOptions.map(item => ( handleConfluenceToggle(item)}
  className="rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-0"
/>
{item}
))}            Notas del Ensayo
             setFormData({...formData, notes: e.target.value})}
              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 h-16"
              placeholder="Detalles de la narrativa, tiempo de reacción..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button 
              type="button" 
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold"
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded font-bold"
            >
              Guardar Trade
            </button>
          </div>
        </form>
      </div>
    </div>
  )}
</div>
);
}

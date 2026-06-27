import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';

interface ChartProps {
  klines: any[];
}

export function Chart({ klines }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#8888a0',
      },
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#4a9eff',
          labelBackgroundColor: '#4a9eff',
        },
        horzLine: {
          color: '#4a9eff',
          labelBackgroundColor: '#4a9eff',
        },
      },
      rightPriceScale: {
        borderColor: '#2a2a3e',
      },
      timeScale: {
        borderColor: '#2a2a3e',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00d084',
      downColor: '#ff4757',
      borderUpColor: '#00d084',
      borderDownColor: '#ff4757',
      wickUpColor: '#00d084',
      wickDownColor: '#ff4757',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !klines.length) return;

    const data: CandlestickData[] = klines.map((k) => ({
      time: (k.time / 1000) as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    candleSeriesRef.current.setData(data);
  }, [klines]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

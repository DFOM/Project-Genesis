import React, { useEffect, useState } from 'react';
import type { Snapshot } from '../preload/ipc.js';
import { MapCanvas } from './MapCanvas.js';
import { Controls } from './Controls.js';

const PAGE: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  color: '#e6e6e6',
  background: '#151515',
  minHeight: '100vh',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export function App(): React.JSX.Element {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => window.genesis.onSnapshot(setSnap), []);

  return (
    <div style={PAGE}>
      <h1 style={{ margin: 0, fontSize: 20 }}>GENESIS</h1>
      <div style={{ display: 'flex', gap: 24, fontVariantNumeric: 'tabular-nums' }}>
        <span>
          tick <strong>{snap?.tick ?? 0}</strong>
        </span>
        <span>alive {snap?.alive ?? 0}</span>
        <span>dead {snap?.dead ?? 0}</span>
      </div>
      <Controls tick={snap?.tick ?? 0} />
      <MapCanvas snapshot={snap} />
      <p style={{ color: '#777', fontSize: 12, margin: 0 }}>
        Phase 0/1 — heuristic bots, no LLM. Ore (gold, north) is useless by design; grain
        (yellow, east) is food, water (blue, south) is drink. Red agents are starving.
      </p>
    </div>
  );
}

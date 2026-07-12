// Play / Pause / Step / Speed / Reset / Fork controls. Sends SimCommands to the main process.
import React, { useState } from 'react';
import type { SimCommand } from '../preload/ipc.js';

const BTN: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#eee',
  border: '1px solid #444',
  borderRadius: 4,
  padding: '6px 12px',
  cursor: 'pointer',
};

export function Controls({ tick }: { tick: number }): React.JSX.Element {
  const [speed, setSpeed] = useState(10);
  const send = (c: SimCommand): void => void window.genesis.send(c);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button style={BTN} onClick={() => send({ type: 'play' })}>
        ▶ Play
      </button>
      <button style={BTN} onClick={() => send({ type: 'pause' })}>
        ⏸ Pause
      </button>
      <button style={BTN} onClick={() => send({ type: 'step' })}>
        ⏭ Step
      </button>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        Speed
        <input
          type="range"
          min={1}
          max={60}
          value={speed}
          onChange={(e) => {
            const tps = Number(e.target.value);
            setSpeed(tps);
            send({ type: 'setSpeed', ticksPerSecond: tps });
          }}
        />
        {speed}/s
      </label>
      <button style={BTN} onClick={() => send({ type: 'reset' })}>
        ↺ Reset
      </button>
      <button style={BTN} onClick={() => send({ type: 'fork', atTick: tick })}>
        ⑂ Fork @ {tick}
      </button>
    </div>
  );
}

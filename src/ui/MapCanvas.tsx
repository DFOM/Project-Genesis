// Top-down Canvas map: terrain, resource nodes, and agents. Purely presentational — it
// renders a Snapshot pushed from the main process.
import React, { useEffect, useRef } from 'react';
import type { Snapshot } from '../preload/ipc.js';

const TERRAIN_COLOR: Record<string, string> = {
  plain: '#2b2f24',
  hill: '#4a3f33',
  water: '#1d3b52',
  field: '#3f4a24',
};

const ITEM_COLOR: Record<string, string> = {
  ore: '#c9a86a',
  water: '#5fb2e0',
  grain: '#d8c24a',
};

const PX = 11; // pixels per tile

export function MapCanvas({ snapshot }: { snapshot: Snapshot | null }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !snapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { size, terrain, nodes, agents } = snapshot;

    // Terrain
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = TERRAIN_COLOR[terrain[y * size + x] ?? 'plain'] ?? '#000';
        ctx.fillRect(x * PX, y * PX, PX, PX);
      }
    }
    // Resource nodes (dim if depleted)
    for (const n of nodes) {
      ctx.fillStyle = ITEM_COLOR[n.item] ?? '#fff';
      ctx.globalAlpha = n.stock > 0 ? 0.9 : 0.25;
      ctx.fillRect(n.x * PX + 2, n.y * PX + 2, PX - 4, PX - 4);
    }
    ctx.globalAlpha = 1;
    // Agents: white alive, red ring if in distress, grey if dead
    for (const a of agents) {
      const cx = a.x * PX + PX / 2;
      const cy = a.y * PX + PX / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, PX / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = !a.alive ? '#555' : a.distress ? '#e5533a' : '#f4f4f4';
      ctx.fill();
      if (a.alive && a.distress) {
        ctx.strokeStyle = '#ff2d2d';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [snapshot]);

  const dim = (snapshot?.size ?? 64) * PX;
  return <canvas ref={ref} width={dim} height={dim} style={{ border: '1px solid #333', imageRendering: 'pixelated' }} />;
}

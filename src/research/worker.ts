// A worker thread: runs one seed's diagnostic and posts the report back. diagnose() is pure and
// seed-independent, so a seed produces byte-identical results whether run alone or in a pool.
import { parentPort } from 'node:worker_threads';
import { diagnose } from '../orchestrator/diagnostics.js';

if (!parentPort) throw new Error('research/worker must run as a worker thread');

parentPort.on('message', (msg: { seed: number; ticks: number }) => {
  const report = diagnose(msg.seed, msg.ticks);
  parentPort!.postMessage({ seed: msg.seed, report });
});

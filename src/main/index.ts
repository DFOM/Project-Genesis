// Electron main process. Owns the SQLite event store and the Simulation, drives the tick
// loop with a timer (pacing lives here — the engine never reads a clock), and streams
// Snapshots to the renderer. Handles Play/Pause/Step/Speed/Reset/Fork commands over IPC.
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { snapshot } from '../engine/index.js';
import { Simulation, heuristicBot, makeConfig } from '../orchestrator/index.js';
import { SqliteEventStore } from '../store/index.js';
import { IPC, type SimCommand } from '../preload/ipc.js';

const DEFAULT_SEED = 42;
const DEFAULT_TPS = 10;

class AppController {
  private store!: SqliteEventStore;
  private sim!: Simulation;
  private win: BrowserWindow | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticksPerSecond = DEFAULT_TPS;
  private stepping = false;
  private runCounter = 0;
  private seed = DEFAULT_SEED;

  init(win: BrowserWindow): void {
    this.win = win;
    this.store = new SqliteEventStore(join(app.getPath('userData'), 'genesis.sqlite'));
    this.newRun(this.seed);
    this.pushSnapshot();
  }

  private nextRunId(): string {
    return `run-${this.seed}-${this.runCounter++}`;
  }

  private newRun(seed: number): void {
    this.seed = seed;
    this.sim = Simulation.create(this.nextRunId(), makeConfig(seed), this.store, heuristicBot);
  }

  private pushSnapshot(): void {
    this.win?.webContents.send(IPC.snapshot, snapshot(this.sim.world));
  }

  private async tick(): Promise<void> {
    if (this.stepping) return; // never overlap async steps
    this.stepping = true;
    try {
      await this.sim.stepOnce();
      this.pushSnapshot();
    } finally {
      this.stepping = false;
    }
  }

  private play(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), Math.max(1, Math.floor(1000 / this.ticksPerSecond)));
  }

  private pause(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async handle(command: SimCommand): Promise<void> {
    switch (command.type) {
      case 'play':
        this.play();
        break;
      case 'pause':
        this.pause();
        break;
      case 'step':
        this.pause();
        await this.tick();
        break;
      case 'setSpeed':
        this.ticksPerSecond = Math.max(1, command.ticksPerSecond);
        if (this.timer) {
          this.pause();
          this.play();
        }
        break;
      case 'reset':
        this.pause();
        this.newRun(this.seed);
        this.pushSnapshot();
        break;
      case 'fork': {
        this.pause();
        const forkId = `${this.sim.runId}-fork@${command.atTick}`;
        this.store.fork(this.sim.runId, command.atTick, forkId);
        const world = this.store.replay(forkId);
        this.sim = Simulation.resume(forkId, world, this.store, heuristicBot);
        this.pushSnapshot();
        break;
      }
      default: {
        const _exhaustive: never = command;
        throw new Error(`unknown command ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

const controller = new AppController();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Genesis',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  controller.init(win);
}

ipcMain.handle(IPC.command, async (_e, command: SimCommand) => {
  await controller.handle(command);
});

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

import type { MaintenanceService } from './maintenance-service.js';

export const SCHEDULER_TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * In-process background scheduler.
 * Evaluates "due and idle" conditions every 5 minutes.
 * Handles catch-up on server wake or restart without fixed clock times.
 */
export class MaintenanceScheduler {
  private maintenanceService: MaintenanceService;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(maintenanceService: MaintenanceService) {
    this.maintenanceService = maintenanceService;
  }

  start(intervalMs = SCHEDULER_TICK_INTERVAL_MS): void {
    if (this.timer) clearInterval(this.timer);

    // Initial tick on start/wake
    this.tick().catch((err) => {
      console.warn('[MAINTENANCE_SCHEDULER] Error in startup tick:', err);
    });

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.warn('[MAINTENANCE_SCHEDULER] Error in periodic tick:', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(nowMs = Date.now()): Promise<void> {
    if (this.isRunning) return;

    try {
      this.isRunning = true;
      const evaluation = await this.maintenanceService.isPruneDueAndIdle(nowMs);
      if (evaluation.due && evaluation.idle) {
        console.log(`[MAINTENANCE_SCHEDULER] Triggering scheduled maintenance: ${evaluation.reason}`);
        await this.maintenanceService.runMaintenance({ nowMs });
      }
    } catch (err: any) {
      console.warn('[MAINTENANCE_SCHEDULER] Tick execution failed:', err.message || err);
    } finally {
      this.isRunning = false;
    }
  }
}

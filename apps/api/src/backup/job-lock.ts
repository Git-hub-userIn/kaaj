import type { BackupTarget } from './backup-target.js';

export interface LockData {
  holder: string;
  token: number;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * Cooperative lease lock with heartbeat and monotonic fencing token.
 * Prevents concurrent backup and prune operations.
 * Stale leases expire automatically so crashed processes do not cause permanent deadlocks.
 */
export class JobLock {
  private target: BackupTarget;
  private lockPath = 'lock/job-lock.json';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeToken: number | null = null;
  private activeHolder: string | null = null;

  constructor(target: BackupTarget) {
    this.target = target;
  }

  /**
   * Attempts to acquire the lease lock.
   * Returns fencing token if acquired, or null if lock is currently held by an active lease.
   */
  async acquire(holder: string, ttlMs = 60000): Promise<number | null> {
    const now = Date.now();
    let currentLock: LockData | null = null;

    try {
      const raw = await this.target.get(this.lockPath);
      if (raw) {
        currentLock = JSON.parse(raw.toString('utf8'));
      }
    } catch {
      // Lock file doesn't exist or is unparseable
    }

    if (currentLock && currentLock.expiresAt > now && currentLock.holder !== holder) {
      // Valid unexpired lease held by someone else
      return null;
    }

    const nextToken = (currentLock?.token ?? 0) + 1;
    const newLock: LockData = {
      holder,
      token: nextToken,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };

    await this.target.put(
      this.lockPath,
      Buffer.from(JSON.stringify(newLock, null, 2), 'utf8'),
      'application/json'
    );

    this.activeToken = nextToken;
    this.activeHolder = holder;

    // Start periodic heartbeat to renew lease
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const renewInterval = Math.max(1000, Math.floor(ttlMs / 2));
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.heartbeat(ttlMs);
      } catch (err) {
        console.warn(`[JOB_LOCK] Heartbeat renewal failed for ${holder}:`, err);
      }
    }, renewInterval);

    return nextToken;
  }

  /**
   * Renews the active lease.
   */
  async heartbeat(ttlMs = 60000): Promise<boolean> {
    if (!this.activeToken || !this.activeHolder) return false;
    const now = Date.now();
    const renewedLock: LockData = {
      holder: this.activeHolder,
      token: this.activeToken,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
    try {
      await this.target.put(
        this.lockPath,
        Buffer.from(JSON.stringify(renewedLock, null, 2), 'utf8'),
        'application/json'
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Releases the lease lock.
   */
  async release(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.target.delete) {
      try {
        await this.target.delete(this.lockPath);
      } catch {}
    } else {
      // Write expired lock if delete not supported
      try {
        const expiredLock: LockData = {
          holder: '',
          token: this.activeToken || 0,
          acquiredAt: 0,
          expiresAt: 0,
        };
        await this.target.put(
          this.lockPath,
          Buffer.from(JSON.stringify(expiredLock, null, 2), 'utf8'),
          'application/json'
        );
      } catch {}
    }

    this.activeToken = null;
    this.activeHolder = null;
  }

  getActiveToken(): number | null {
    return this.activeToken;
  }
}

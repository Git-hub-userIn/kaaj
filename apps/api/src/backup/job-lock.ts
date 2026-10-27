import type { BackupTarget } from './backup-target.js';
import { prisma as defaultPrisma } from '../db/client.js';
import { JobLeaseManager } from '../db/hot-paths.js';
import type { PrismaClient } from '../generated/client/index.js';

export interface LockData {
  holder: string;
  token: number;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * Cooperative lease lock with heartbeat and monotonic fencing token stored in PostgreSQL.
 * Replaces file-based lock with ACID-compliant, crash-resilient database row lease.
 * Prevents concurrent backup and prune operations across clustered or concurrent instances.
 */
export class JobLock {
  private leaseManager: JobLeaseManager;
  private activeToken: number | null = null;
  private activeHolder: string | null = null;

  constructor(_target?: BackupTarget, prisma?: PrismaClient) {
    this.leaseManager = new JobLeaseManager(prisma || defaultPrisma, 'backup_maintenance');
  }

  /**
   * Attempts to acquire the lease lock in PostgreSQL.
   * Returns fencing token if acquired, or null if lock is currently held by an active lease.
   */
  async acquire(holder: string, ttlMs = 60000): Promise<number | null> {
    const token = await this.leaseManager.acquire(holder, ttlMs);
    if (token !== null) {
      this.activeToken = token;
      this.activeHolder = holder;
      return token;
    }
    return null;
  }

  /**
   * Renews the active lease heartbeat in PostgreSQL.
   */
  async heartbeat(ttlMs = 60000): Promise<boolean> {
    return await this.leaseManager.heartbeat(ttlMs);
  }

  /**
   * Validates if a fencing token is still active.
   */
  async validateToken(token: number): Promise<boolean> {
    return await this.leaseManager.validateFencingToken(token);
  }

  /**
   * Releases the lease lock in PostgreSQL.
   */
  async release(): Promise<void> {
    await this.leaseManager.release();
    this.activeToken = null;
    this.activeHolder = null;
  }

  getActiveToken(): number | null {
    return this.activeToken;
  }
}

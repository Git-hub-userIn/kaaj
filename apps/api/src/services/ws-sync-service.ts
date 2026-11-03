import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as ypm from 'y-prosemirror';
import type { CategoriesService } from './categories-service.js';
import type { MaintenanceService } from '../backup/maintenance-service.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface RoomSession {
  roomKey: string;
  userId: string;
  entryId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<any>;
  debounceTimer: any;
  isDirty: boolean;
  isFlushing: boolean;
  destroyed: boolean;
}

export class WsSyncService {
  private rooms: Map<string, RoomSession> = new Map();
  private categoriesService: CategoriesService;
  private maintenanceService: MaintenanceService;

  constructor(categoriesService: CategoriesService, maintenanceService: MaintenanceService) {
    this.categoriesService = categoriesService;
    this.maintenanceService = maintenanceService;
  }

  getRoomKey(userId: string, entryId: string): string {
    return `${userId}:${entryId}`;
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  async getOrCreateRoom(userId: string, entryId: string): Promise<RoomSession> {
    const key = this.getRoomKey(userId, entryId);
    let room = this.rooms.get(key);
    if (room && !room.destroyed) {
      return room;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    room = {
      roomKey: key,
      userId,
      entryId,
      doc,
      awareness,
      clients: new Set(),
      debounceTimer: null,
      isDirty: false,
      isFlushing: false,
      destroyed: false,
    };

    // Broadcast document updates to peers and schedule debounced flush
    doc.on('update', (update: Uint8Array, origin: any) => {
      if (!room || room.destroyed) return;
      room.isDirty = true;

      // Broadcast update to all other connected clients
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const msg = encoding.toUint8Array(encoder);

      for (const client of room.clients) {
        if (client !== origin && client.readyState === 1) {
          try {
            client.send(msg);
          } catch {}
        }
      }

      this.scheduleDebouncedFlush(room);
    });

    // Broadcast awareness updates to peers
    awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
      if (!room || room.destroyed) return;
      const changed = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changed)
      );
      const msg = encoding.toUint8Array(encoder);

      for (const client of room.clients) {
        if (client !== origin && client.readyState === 1) {
          try {
            client.send(msg);
          } catch {}
        }
      }
    });

    this.rooms.set(key, room);
    return room;
  }

  handleClientConnected(room: RoomSession, ws: any): void {
    room.clients.add(ws);

    // 1. Send SyncStep1 to client
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));

    // 2. Send current awareness states to client
    const awarenessStates = room.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoderAwareness = encoding.createEncoder();
      encoding.writeVarUint(encoderAwareness, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoderAwareness,
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      ws.send(encoding.toUint8Array(encoderAwareness));
    }
  }

  handleClientMessage(room: RoomSession, ws: any, rawData: ArrayBuffer | Uint8Array): void {
    const uint8 = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
    if (uint8.length === 0) return;

    try {
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);

        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
      }
    } catch (err) {
      console.error(`[WS_SYNC] Error processing message in room ${room.roomKey}:`, err);
    }
  }

  async handleClientDisconnected(room: RoomSession, ws: any): Promise<void> {
    room.clients.delete(ws);

    // Remove client awareness state
    if (ws.clientId !== undefined) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [ws.clientId], null);
    }

    // Flush immediately when last client leaves the room
    if (room.clients.size === 0) {
      if (room.debounceTimer) {
        clearTimeout(room.debounceTimer);
        room.debounceTimer = null;
      }
      await this.flushRoomToDatabase(room);
      room.destroyed = true;
      room.doc.destroy();
      this.rooms.delete(room.roomKey);
    }
  }

  scheduleDebouncedFlush(room: RoomSession): void {
    if (room.debounceTimer) {
      clearTimeout(room.debounceTimer);
    }
    room.debounceTimer = setTimeout(() => {
      room.debounceTimer = null;
      this.flushRoomToDatabase(room).catch((err) => {
        console.error(`[WS_SYNC] Error in debounced flush for room ${room.roomKey}:`, err);
      });
    }, 1500);
  }

  async flushRoomToDatabase(room: RoomSession): Promise<void> {
    if (!room.isDirty || room.isFlushing) return;
    room.isFlushing = true;

    try {
      const fragment = room.doc.getXmlFragment('default');
      const pmJson = (ypm as any).yXmlFragmentToProsemirrorJSON(fragment);

      if (pmJson && pmJson.content && Array.isArray(pmJson.content)) {
        const catSvc = this.categoriesService.forUser(room.userId);
        await catSvc.saveEntryDoc(room.entryId, {
          schemaVersion: 2,
          doc: pmJson,
        });
        this.maintenanceService.forUser(room.userId).recordEdit();
        room.isDirty = false;
      }
    } catch (err) {
      console.error(`[WS_SYNC] Failed to flush room ${room.roomKey} to database:`, err);
    } finally {
      room.isFlushing = false;
    }
  }

  async flushAllRooms(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      if (room.isDirty) {
        promises.push(this.flushRoomToDatabase(room));
      }
    }
    await Promise.allSettled(promises);
  }
}

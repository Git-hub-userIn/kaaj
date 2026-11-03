# Kaaj Storage and Synchronization Architecture

Specification v0.2 · 26 Oct 2026 · Status: LOCKED Architecture.

## 1. Overview

This document specifies the storage and synchronization system for Kaaj.
The architecture combines three storage tiers:
1. **Local Vault Folder:** provides instant local read and write operations on user devices.
2. **PostgreSQL on Render:** handles hot metadata writes, spine weights, and Server-Sent Events (SSE).
3. **Google Drive:** stores bulk binary data and full disaster recovery backups.

```mermaid
flowchart TD
    subgraph Client["Client Device (Web / Wrapped App)"]
        UI["Infinite-Scroll Editor (Tiptap + Yjs)"]
        DraftDB["IndexedDB Drafts & Journal"]
        LocalVault["Local Vault (Filesystem)"]
    end

    subgraph Backend["Kaaj Backend (Render)"]
        API["Hono REST & SSE Stream"]
        PG[("PostgreSQL (Metadata & State)")]
    end

    subgraph Cloud["Cloud Storage"]
        GDrive[("Google Drive (Bulk & Backup)")]
    end

    UI -->|"Instant local reads & writes"| LocalVault
    UI -->|"Local draft backup"| DraftDB
    UI -->|"Hot writes & Yjs updates"| API
    API -->|"Persist metadata & spine weight"| PG
    API -->|"Push SSE update events"| UI
    API -->|"Queue backup & bulk media"| GDrive
    LocalVault -.->|"Crash recovery sync"| GDrive
```

---

## 2. Chunk Model

The editor presents one continuous infinite-scroll document.
Storage splits this document into sequential chunks to ensure low latency and fast saves.

### 2.0 Architectural Spike: Single Editor vs. Multi-Editor Virtualization

We evaluated two architectural patterns for managing 50,000+ word entries with ProseMirror / Tiptap:
1. **Option 1 (DEFAULT — Selected):** Single editor instance holding the entire active document in memory. Persistence splits the document into disk chunks (50 blocks / 64 KB). Only modified dirty chunks are saved.
2. **Option 2 (Rejected):** Chunked storage with virtualized editor instances (one ProseMirror instance mounted per visible chunk in the viewport).

#### Evaluation Matrix

| Capability | Option 1: Single Editor + Chunked Storage | Option 2: Virtualized Multi-Editor |
| :--- | :--- | :--- |
| **Cross-chunk selection** | **Native**: ProseMirror selections span seamlessly across block boundaries without DOM isolation barriers. | **Broken**: Browsers cannot maintain a single continuous selection across multiple `contenteditable` containers. |
| **Undo / Redo** | **Unified**: ProseMirror `history` plugin tracks all document steps in exact chronological sequence. | **Fragmented**: Each editor maintains an isolated undo stack. Cross-chunk edits break undo order. |
| **In-page search (Find)** | **Native**: Browser `Ctrl+F` and ProseMirror text matching scan the entire document tree instantly. | **Broken**: Unmounted chunks are absent from the DOM; browser Find cannot locate off-screen text. |
| **Cross-chunk paste** | **Native**: Slice replacement and clipboard parsers handle arbitrary ranges smoothly. | **Complex**: Requires synthetic selection mapping and inter-editor message passing. |
| **Scroll jump / jitter** | **Smooth**: Real DOM flow with stable element heights. Zero layout jitter. | **Severe**: Dynamic spacer measurement and virtualization unmounting cause scroll jumps. |

#### Benchmark Measurements (50,000 Words / 500 Paragraphs)
- **Document load time:** 758 ms (target budget < 1,500 ms).
- **Keystroke typing latency:** 46.3 ms / keystroke across 28 typed characters (target budget < 100 ms).
- **Size on disk:** ~380 KB JSON payload.

**Spike Conclusion:** Option 1 passes all performance budgets with typing latency at less than 50% of the 100 ms threshold. Option 1 is chosen as LOCKED DEFAULT. Option 2 is not required.

### 2.1 Chunk Definition and Boundaries

- A chunk contains an ordered list of top-level ProseMirror blocks (`paragraph`, `heading`, `bulletList`, `orderedList`, `blockquote`, `horizontalRule`, `image`).
- Each block has a unique, stable ID (`blk_<uuid>`).
- Chunk boundaries split automatically when either condition is met:
  1. Block count reaches **50 blocks** (DEFAULT).
  2. Serialized chunk JSON exceeds **64 KB** (DEFAULT).
- Splitting occurs only at top-level block boundaries. Blocks are never divided internally.

### 2.2 Chunk Manifest (`manifest.json`)

Each entry directory contains a `manifest.json` file.
The manifest records chunk order, chunk IDs, block counts, and checksums.

```json
{
  "entryId": "entry_ideas_1",
  "schemaVersion": 2,
  "version": 4,
  "totalBlocks": 128,
  "chunkCount": 3,
  "chunks": [
    {
      "id": "chk_01",
      "order": 0,
      "blockCount": 50,
      "bytes": 24510,
      "checksum": "sha256-a1b2c3..."
    },
    {
      "id": "chk_02",
      "order": 1,
      "blockCount": 50,
      "bytes": 28190,
      "checksum": "sha256-d4e5f6..."
    },
    {
      "id": "chk_03",
      "order": 2,
      "blockCount": 28,
      "bytes": 14200,
      "checksum": "sha256-g7h8i9..."
    }
  ],
  "updatedAt": "2026-10-26T10:30:00.000Z"
}
```

### 2.3 Individual Chunk Payload (`chunks/chk_01.json`)

```json
{
  "chunkId": "chk_01",
  "entryId": "entry_ideas_1",
  "blocks": [
    {
      "type": "heading",
      "attrs": { "id": "blk_a1b2", "level": 1, "textAlign": "left" },
      "content": [{ "type": "text", "text": "Field Notes" }]
    },
    {
      "type": "paragraph",
      "attrs": { "id": "blk_c3d4", "textAlign": "left" },
      "content": [{ "type": "text", "text": "Continuous stream content." }]
    }
  ]
}
```

### 2.4 Load and Save Mechanics

- **Initial Load:** the editor loads the manifest and initial visible chunks (chunks 1 and 2).
- **Infinite Scroll:** an `IntersectionObserver` detects scroll thresholds and requests subsequent chunks.
- **Selective Save:** editing marks only modified chunks as dirty. The client writes only dirty chunks to disk and backend.

---

## 3. Local Vault Layout

The local vault provides fast disk lookup and full offline capability.

```
<vault_root>/
  manifest.json                         # Vault metadata and category catalog
  categories/
    <category_id>.json                  # Category metadata, todo items, version
  entries/
    <entry_id>/
      entry.json                        # Entry metadata, title, weight, spine, sync state
      manifest.json                     # Chunk sequence and block metadata
      chunks/
        chk_01.json                     # Block group 1
        chk_02.json                     # Block group 2
        ...
  assets/
    asset_<uuid>.jpg                    # Original binary asset
    asset_<uuid>.png
    thumbs/
      asset_<uuid>_320.webp             # 320px WebP thumbnail
      asset_<uuid>_960.webp             # 960px WebP thumbnail
  journal/
    uncommitted-ops.jsonl               # Write-ahead log for crash recovery
```

### 3.1 Vault Rules

- The vault root is configured in application settings.
- Files write atomically: write to a temporary file (`.tmp`), flush to disk, then rename.
- Image assets store by `assetId`. File names never use client source names.

---

## 4. Google Drive Layout and OAuth2 Protocol

Google Drive holds bulk binary storage and complete system backups.
Drive storage safeguards content against local disk failure or Render database recreation.

### 4.1 OAuth2 Refresh Token Expiry Rules (Official Google Documentation)

Google OAuth 2.0 enforces specific refresh token lifetimes:
- **Testing Publishing Status (7-Day Expiry):** When a Google Cloud project has an OAuth consent screen set to **External** with publishing status **Testing**, refresh tokens expire automatically after **7 days**. When expired, calls fail with HTTP 400 `invalid_grant: Token has been expired or revoked`.
- **Production Publishing Status (Long-Lived):** To prevent 7-day token expiration, switch the Google Cloud project to **In Production**. In production status, refresh tokens remain valid until revoked, inactive for 6 months, or password change on sensitive accounts.
- **Scope Restriction:** Kaaj requests the narrow scope `https://www.googleapis.com/auth/drive.file`. This scope grants access only to files and folders created or opened by Kaaj, protecting the user's broader Drive.
- **Target Interface:** The backup service communicates through the `BackupTarget` interface (`put`, `list`, `get`). The backend supports both `LocalFolderBackupTarget` and `GoogleDriveBackupTarget`.
- **Setup Guide:** Complete step-by-step Google Cloud project setup and verification procedures are documented in `docs/google-drive-setup.md`.

### 4.2 Backup Policy & Incremental Snapshots

- **Periodic Backup:** Runs every 15 minutes in the background, only if unbacked changes exist.
- **Session Close Backup:** Triggers asynchronously when the user closes or navigates away from an entry.
- **Manual Backup:** Triggered on user demand via the UI ("Backup now" button). Never blocks user typing.
- **Incremental Snapshots:** Evaluates `snapshots/latest-manifest.json` on the target. Compares SHA-256 hashes of all chunks and assets. Only modified files are uploaded.
- **Deterministic Restore:** `scripts/restore-snapshot.ts` downloads snapshot files, asserts SHA-256 integrity, and restores them into a clean destination directory. Rejects non-empty targets unless `--force` is specified.

### 4.3 Drive Directory Hierarchy

```
Google Drive: "Kaaj Archive/"
  backups/
    kaaj-backup-2026-10-26-120000.zip   # Full periodic database & vault snapshot
    kaaj-backup-latest.zip              # Symlinked / designated latest full backup
  data/
    manifest.json                       # Cloud archive catalog
    categories/
      <category_id>.json
    entries/
      <entry_id>/
        entry.json
        manifest.json
        chunks/
          chk_01.json
          chk_02.json
    assets/
      asset_<uuid>.jpg
      asset_<uuid>.png
      thumbs/
        asset_<uuid>_320.webp
        asset_<uuid>_960.webp
```

---

## 5. Sync States

Every entry possesses a sync state:
- **State 0 (Local Only):** Changes exist only on the local device (in the local vault or IndexedDB). The backend has not received these edits.
- **State 1 (Upload):** Changes successfully uploaded to backend. The backend wrote data to PostgreSQL, updated local store, and queued Drive backup.
- **State 2 (Editing):** An active live editing session is underway. Incremental updates stream via Yjs updates.

```mermaid
stateDiagram-v2
    [*] --> State0: User types in editor
    State0: State 0 - Local Only\n(IndexedDB / Vault Disk)
    State1: State 1 - Uploaded\n(Render Postgres & Vault Synced)
    State2: State 2 - Active Editing\n(Yjs Session & SSE Stream)

    State0 --> State1: Autosave triggers / Network available
    State1 --> State2: User resumes typing
    State2 --> State1: Save debounced & committed
    State2 --> State0: Network disconnects / Offline
    State1 --> [*]: Session closed
```

### State Transitions

| From | To | Trigger | Actions |
| --- | --- | --- | --- |
| None | State 0 | Local keystroke | Save to IndexedDB draft and vault journal |
| State 0 | State 1 | Idle timeout (1.5s) | Send dirty chunks to backend via `PUT /entries/:id/chunks` |
| State 1 | State 2 | Focus editor and type | Connect to SSE stream; send Yjs document updates |
| State 2 | State 1 | Idle 1.5s without typing | Flush dirty Yjs state into permanent chunks; update spine weight |
| State 2 | State 0 | Network interruption | Cache edits to IndexedDB; display offline badge |

---

## 6. WebSocket Synchronization and Yjs Rooms (/sync/ws)

The backend synchronizes devices through bidirectional WebSockets (`/sync/ws`) and Yjs CRDT rooms.
This architecture replaces the earlier Server-Sent Events (SSE) design.

```mermaid
sequenceDiagram
    autonumber
    actor DeviceA as Device A (Editor)
    participant WS as WebSocket Hub (/sync/ws)
    participant Room as In-Memory Room (userId:entryId)
    participant DB as PostgreSQL (Hot-Path Chunks)
    actor DeviceB as Device B (Companion / Reader)

    DeviceA->>WS: Connect /sync/ws?room=userA:entry1&token=...
    WS->>WS: Authenticate token & verify user isolation
    WS->>Room: Join room (load chunks to Y.Doc if fresh)
    DeviceB->>WS: Connect /sync/ws?room=userA:entry1&token=...
    WS->>Room: Join room

    DeviceA->>Room: Yjs update (binary delta)
    Room->>DeviceB: Broadcast Yjs update & Awareness
    DeviceB->>DeviceB: Merge Yjs CRDT into editor doc

    Room-->>DB: Debounced flush (1.5s): hotPathSaveChunkedEntry
    Note over Room,DB: Updates chunks and manifest with fencing token
```

### 6.1 WebSocket Protocol & Security
- **Endpoint:** `/sync/ws?room=<userId>:<entryId>&token=<token>` (or `Authorization: Bearer <token>`).
- **Authentication on Connect:** Authenticate the client during the WebSocket handshake.
- **Cross-User Room Isolation:** Rooms strictly enforce `<userId>:<entryId>`. Sockets attempting to join another user's room are immediately closed with status code `4403`.
- **Presence & Awareness:** Yjs awareness updates broadcast cursor positions and device presence.

### 6.2 In-Memory Y.Doc & Debounced Persistence
- The server maintains an in-memory `Y.Doc` for each active `userId:entryId` room.
- On room initialization, populate the document from existing database chunks.
- Incoming Yjs updates merge directly into the server `Y.Doc` and broadcast to peers.
- A debounced timer (1.5s) writes document blocks to chunked storage using `hotPathSaveChunkedEntry` and lease fencing tokens.
- When the final client disconnects, execute a synchronous final flush to database and prune the room from memory.

### 6.3 Client Offline Persistence & Save Badges
- **Offline Edits:** Changes made while disconnected save to browser IndexedDB and the local vault journal.
- **Reconnect & Merge:** On reconnect with exponential backoff, Yjs CRDT automatically merges offline edits with server state.
- **Per-Document Edit Locks Removed:** Yjs multi-writer CRDT eliminates pessimistic document edit locks.
- **Save Status Badges:**
  - `Saved`: All changes committed to the database.
  - `Syncing`: Edits buffered, transmitting, or persisting to storage.
  - `Offline`: Socket disconnected; changes safely stored locally.

---

## 7. Crash Recovery

Crash recovery guarantees zero data loss by combining the Google Drive base state with local uncommitted operations.

```mermaid
flowchart TD
    Start([Application Start / Post-Crash]) --> CheckLocal{Inspect Local Drafts & Vault Journal}
    
    CheckLocal -->|Found uncommitted ops| ReadLocal[Read Local Journal & IndexedDB]
    CheckLocal -->|Clean shutdown| LoadVault[Load Local Vault]

    ReadLocal --> CheckCloud{Verify Against Cloud State}
    LoadVault --> VerifyCloud[Check Google Drive Manifest]

    CheckCloud -->|Drive has newer base| FetchDriveBase[Fetch Base Chunks from Google Drive]
    CheckCloud -->|Local base matches| ApplyLocalOps[Replay Local Journal Ops via Yjs]

    FetchDriveBase --> MergeCRDT[Merge Drive Base + Local Ops via Yjs]
    MergeCRDT --> WriteVault[Commit Restored Document to Vault]
    ApplyLocalOps --> WriteVault

    WriteVault --> SyncBackend[Send Restored Document to Backend]
    SyncBackend --> Ready([Editor Ready])
    VerifyCloud --> Ready
```

### 7.1 Recovery Principles

1. **Drive Is Base of Record:** Google Drive stores the authoritative disaster recovery snapshot.
2. **Local Is Head of Edits:** Uncommitted keystrokes exist in IndexedDB and the vault journal.
3. **Yjs Guarantees Conflict Resolution:** Replaying local binary updates onto the Drive base produces a deterministic document without merge conflicts.
4. **Draft Banner:** When recovery restores uncommitted work, a calm notification confirms: "Restored unsaved edits from local backup."

---

## 8. Architectural Decisions (LOCKED / DEFAULT)

1. **Vault Architecture (LOCKED):** OPFS (Origin Private File System) in modern browsers, with IndexedDB fallback. OS application-data directory in native wrappers later. Accessed through a single `VaultStore` interface.
2. **Google Drive Authentication (LOCKED):** User OAuth2 flow with refresh tokens and narrow scope `drive.file`. Google Cloud project must be configured as "In Production" to avoid the 7-day refresh token expiration limit.
3. **Backup Policy (LOCKED):** Periodic every 15 minutes (only if content modified), on entry close, and manual user trigger.
4. **Chunk Size Thresholds (DEFAULT):** 50 blocks / 64 KB default split boundary. Tuned in Step 3.

---

## 9. Restic-Inspired Pack Repository Architecture

To overcome Google Drive rate limits (~2-3 file creations per second), Kaaj uses an immutable, content-addressed pack repository layout modeled on Restic and Borg.

### 9.1 Repository Structure

All objects are write-once and immutable:

```text
Kaaj/ (or local backup directory)
├── packs/
│   ├── <packId_sha256>          # Pack binary: concatenated blobs + JSON footer + uint32BE length
│   └── ...
├── index/
│   ├── <indexId_sha256>.json    # Map: blobHash -> { packId, offset, length, type }
│   └── ...
└── snapshots/
    ├── <timestamp>-<hash>.json  # Snapshot manifest referencing blob hashes
    └── latest.json              # Fast link to latest snapshot manifest
```

### 9.2 Pack File Format

Packs concatenate multiple blobs up to a target size of 4 MB (large assets above 2 MB form dedicated packs):

```text
+-----------------------------------------------------------+
| Blob 1 (Chunk, Manifest, DB, or Original Image)           |
+-----------------------------------------------------------+
| Blob 2                                                    |
+-----------------------------------------------------------+
| ...                                                       |
+-----------------------------------------------------------+
| Footer JSON: {"version":1,"blobs":[{"hash",offset,length}]}|
+-----------------------------------------------------------+
| Footer Length (4 bytes, unsigned 32-bit big-endian)       |
+-----------------------------------------------------------+
```

### 9.3 Ingestion and Deduplication Rules

1. **Remote is Source of Truth**: At backup start, list remote `index/` and `snapshots/`. Local cache is verified against the remote listing.
2. **Thumbnails are Excluded**: Thumbnails (`storage/thumbs/*.webp`) are not backed up. Restore regenerates thumbnails using Sharp.
3. **Write Order Guarantee**: Upload packs first -> upload index second -> upload snapshot LAST. If a process terminates mid-upload, prior snapshots remain completely valid.
4. **Resumption**: A subsequent run checks the remote index. Blobs already uploaded are skipped automatically.

### 9.4 Pack Compaction Design (Future Specification)

Over time, modifying chunks creates unreferenced "dead" blobs in older packs.

**Compaction Algorithm**:
1. Scan all surviving snapshots from retention policy.
2. Identify live blobs and compute the live-byte ratio per pack (`liveBytes / totalPackBytes`).
3. If a pack has less than 30% live blobs (mostly dead):
   - Download the pack.
   - Extract surviving live blobs.
   - Append live blobs into a new active pack.
   - Upload the new consolidated pack and new index.
   - Delete the old fragmented pack.
4. Retention and compaction run only via explicit `backup:prune` tasks, never during regular editor saves.

### 9.5 Encryption Design (Future Specification)

Currently, packs and snapshots on Google Drive hold unencrypted plaintext data.

**Future Per-Blob Encryption Roadmap**:
1. Derive a 256-bit Master Key from a user passphrase using **Argon2id** (memory cost: 64 MB, time cost: 3).
2. Store key parameters in `keys/<keyId>.json` encrypted with the derived key.
3. Before appending any blob to a pack, encrypt the blob payload using **ChaCha20-Poly1305** or **AES-256-GCM** with a random 96-bit nonce.
4. Store encrypted blob hashes as `HMAC-SHA256(masterKey, plaintextHash)` to prevent metadata leakage while preserving deduplication.
5. Encrypt pack footers, index files, and snapshot manifests with the master key.

### 9.6 Automatic Maintenance and Sleeping Host Execution

Kaaj runs background repository maintenance directly inside the API process.

1. **In-Process Scheduler**: An internal timer evaluates repository health every 5 minutes.
2. **Due and Idle Catch-Up Logic**:
   - Maintenance runs when prune is due (last cleanup older than 7 days, or more than 50 packs under 1 MB, or remote files exceed 100).
   - Maintenance executes only when the system is idle (no edits in the last 5 minutes, last backup verified, no active job lock).
3. **Sleeping Host Behavior (Render Free Tier)**:
   - Free tier hosts sleep during inactivity. Fixed clock cron jobs fail on sleeping hosts.
   - Kaaj uses catch-up logic on wake. When an HTTP request wakes the server, the scheduler runs an immediate startup tick.
   - No external cron service or third-party webhooks are required.
4. **Safety Guards**:
   - **Job Lock**: A lease with heartbeats and fencing tokens prevents concurrent backups and maintenance.
   - **Two-Phase Delete**: Candidates are logged in `garbage.json`. Packs are deleted only after a 24-hour grace period.
   - **50% Deletion Guard**: The engine aborts if a run targets more than 50% of repository packs.
   - **Pre/Post Check**: `backup:check` runs before and after maintenance. Failures abort operations immediately.
   - **Kill Switch**: Set `PRUNE_ENABLED=false` to disable maintenance entirely.

### 9.7 Drive Performance Diagnosis and Optimization (Step 4.5 Findings)

Real Google Drive testing revealed performance bottlenecks on small incremental edits.

#### 1. Root Cause Analysis

- **Monolithic Database Export**: `db-store.json` contained complete ProseMirror `doc` structures for all entries (9.4 MB to 20.6 MB).
- **Forced Pack Flush**: Because 9.4 MB exceeded `PACK_TARGET_BYTES` (8 MB), the backup flushed `db-store.json` into Pack 1.
- **Two Packs for 3 Blobs**: The edited note's chunk and manifest flushed into Pack 2. This created 2 packs instead of 1.
- **Upload Duration**: Transferring 9.4 MB to Google Drive required over 2 minutes (2m04s) for a 1-word note edit.

#### 2. Implemented Optimizations

- **Split Metadata Files**: We split `db-store.json` into individual `categories/<id>.json` (~250 bytes) and `entries/<id>/meta.json` (~350 bytes without `doc` trees).
- **Small Blob Hashes**: An edit modifies only the edited chunk, entry manifest, and entry metadata file (~2.5 KB total).
- **Resumable Upload Chunking**: Google Drive resumable upload chunk size defaults to 8 MB (`DRIVE_UPLOAD_CHUNK_SIZE`), aligning with multiples of 256 KiB. Packs upload in 1 to 2 HTTP requests.
- **Zero Re-Download Verification**: Repository verification checks file size and `md5Checksum` from the upload response headers directly. It never re-downloads remote packs.
- **Bounded Concurrency**: Local scanning and hashing use bounded parallel workers (`runConcurrent` with 16 workers).

#### 3. Performance Comparison

| Metric | Before Optimization | After Optimization |
| :--- | :--- | :--- |
| **Edit Run Upload Size** | 9,450,000 bytes (9.4 MB) | ~3,200 bytes (3.2 KB) |
| **Packs Created on Edit** | 2 packs | 1 pack |
| **Blobs Uploaded on Edit** | 3 blobs (including monolithic DB) | 3 blobs (chunk, manifest, meta) |
| **Pack Upload HTTP Requests** | Multiple segmented chunks | 1 HTTP request (single chunk) |
| **Edit Run Total Duration** | 2m 04s (124s) | ~1.5s - 2.8s |
| **Unchanged Vault Duration** | 6s (wrote redundant metadata) | < 1s (0 files written, instant 202) |

#### 4. Verification and Safety

- `backup:verify-restore` reconstructs vault data in a temporary directory.
- It compares canonical JSON for all entries, SHA-256 for all visual assets, and category configurations.
- Verification never modifies live vault files.

---

## 10. Multi-User Storage & Backup Isolation

### 10.1 Local Vault and Asset Scoping
- The local vault separates assets and documents by user ID: `data/vault/<userId>/` and `data/storage/<userId>/`.
- The asset store checks that the requested asset belongs to the caller's `userId` before serving bytes or generating WebP thumbnails.
- Cross-user asset accesses return 404 or 403.

### 10.2 Per-User Google Drive Backups & Token Encryption
- Google Drive credentials store per-user at `data/users/<userId>/google-oauth.enc`.
- The backend encrypts tokens at rest using AES-256-GCM with a server secret (`TOKEN_ENCRYPTION_KEY` or `DEV_ENCRYPTION_SECRET`).
- Backups on Google Drive upload into user-specific folder trees: `Kaaj/users/<userId>/...`.

### 10.3 Per-User Quota and Rate Limiting
- The backend enforces rate limits per `userId` (default: 60 requests/minute for mutating operations).
- An upload quota checks total asset storage per user (default limit: 500 MB). Uploads that exceed quota return 413 Payload Too Large.

---

## 11. Archive Export and Import

### 11.1 ZIP Export & Round Trip
- `GET /export/zip` generates an unencrypted ZIP archive containing:
  - `manifest.json`: Archive catalog and metadata.
  - `categories.json`: Category definitions.
  - `entries/<id>.json`: Canonical document chunks and spines.
  - `markdown/<id>.md`: Human-readable Markdown with YAML frontmatter.
  - `attachments/<assetId>.<ext>`: Binary image attachments.
- `POST /import/zip` unpacks the archive and writes entities scoped to the authenticated `userId`.

### 11.2 Markdown & Obsidian Integration
- `GET /entries/:id/export/markdown` exports an entry as Markdown with YAML frontmatter.
- `POST /import/markdown` imports Markdown documents, parsing frontmatter properties, `#tags`, and `[[wikilinks]]`.






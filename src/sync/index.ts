/**
 * Sync module exports
 */

export {
  type ConflictType,
  type ResolutionStrategy,
  type SyncConflict,
  type ConflictResolution,
  type SyncState,
  calculateEntryChecksum,
  detectConflicts,
  resolveConflict,
  resolveAllConflicts,
  createInitialSyncState,
  updateSyncState,
  displaySyncSummary,
} from './conflictResolver.js';

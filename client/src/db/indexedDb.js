/**
 * @file indexedDb.js
 * @description Backward compatibility adapter for SyncScholar IndexedDB persistence.
 * Forwards all operations to the canonical Dexie.js offline store in `client/src/db/offlineDb.js`.
 */

export * from './offlineDb.js';
export { default } from './offlineDb.js';

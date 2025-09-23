// Handles interactions with IndexedDB for storing uploaded file contents.
// This module provides functions to open the database, store, retrieve, and clear uploaded files.

const DB_NAME = 'RepoPromptDB';
const DB_VERSION = 1;
const STORE_NAME = 'uploadedFiles';

let dbPromise = null;

/**
 * Opens the IndexedDB database.
 * @returns {Promise<IDBDatabase>} - Promise that resolves to the opened database.
 */
function openDB() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.errorCode);
      reject(event.target.error);
    };
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
  return dbPromise;
}

/**
 * Stores an uploaded file's content in IndexedDB with a directory-specific key.
 * @param {number} dirId - The unique identifier of the directory.
 * @param {string} filePath - The file path used in the key.
 * @param {string} content - The content of the file.
 * @returns {Promise<void>}
 */
export async function putUploadedFile(dirId, filePath, content) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const key = `${dirId}:${filePath}`;
    const request = store.put({ key, content });
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Retrieves an uploaded file's content from IndexedDB using a directory-specific key.
 * @param {number} dirId - The unique identifier of the directory.
 * @param {string} filePath - The file path key.
 * @returns {Promise<string|null>} - Promise that resolves to the file content or null if not found.
 */
export async function getUploadedFile(dirId, filePath) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const key = `${dirId}:${filePath}`;
    const request = store.get(key);
    request.onsuccess = (event) => {
      const result = event.target.result;
      resolve(result ? result.content : null);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Clears all uploaded files from IndexedDB.
 * @returns {Promise<void>}
 */
export async function clearUploadedFiles() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}
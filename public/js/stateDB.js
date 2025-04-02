// public/js/stateDB.js
// Provides functions to store and retrieve application state in IndexedDB.

export function openStateDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RepoPromptStateDB', 1);
      request.onerror = (event) => {
        console.error('StateDB error:', event.target.errorCode);
        reject(event.target.error);
      };
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('appState')) {
          db.createObjectStore('appState', { keyPath: 'key' });
        }
      };
    });
  }
  
  /**
   * Stores a value associated with a key in the appState store.
   * @param {string} key - The state key.
   * @param {any} value - The value to store.
   * @returns {Promise<void>}
   */
  export async function setState(key, value) {
    const db = await openStateDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('appState', 'readwrite');
      const store = tx.objectStore('appState');
      const request = store.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }
  
  /**
   * Retrieves a value associated with a key from the appState store.
   * @param {string} key - The state key.
   * @returns {Promise<any>} - The stored value or null if not found.
   */
  export async function getState(key) {
    const db = await openStateDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('appState', 'readonly');
      const store = tx.objectStore('appState');
      const request = store.get(key);
      request.onsuccess = (event) => {
        resolve(event.target.result ? event.target.result.value : null);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }
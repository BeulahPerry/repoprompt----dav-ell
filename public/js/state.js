// Manages application state and persistence.
// Large state properties (directories, failed files) are persisted in IndexedDB via stateDB.js.

import { getState, setState } from './stateDB.js';
import { getDirectories, setDirectories } from './stateDB.js';

export const STORAGE_KEYS = {
  ENDPOINT_URL: 'repoPrompt_endpointUrl',
  PROMPT_SELECTION: 'repoPrompt_promptSelection',
  USER_INSTRUCTIONS: 'repoPrompt_userInstructions',
  WHITELIST: 'repoPrompt_whitelist',
  FAILED_FILES: 'repoPrompt_failedFiles'
};

// Default whitelist of allowed text file extensions.
// Added "dockerfile*" to support Dockerfile variants.
const defaultWhitelist = [
  'dockerfile*',
  '.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.py', '.java', '.c', 
  '.cpp', '.h', '.hpp', '.sh', '.bat', '.yml', '.yaml', '.ini', '.cfg', '.conf',
  '.log', '.csv', '.ts', '.jsx', '.tsx', '.php', '.rb', '.go', '.rs', '.swift',
  '.kt', '.kts', '.scala', '.pl', '.pm', '.r', '.sql', '.dart', '.lua'
];

export const state = {
  fileCache: new Map(),           // Cache for file contents
  directories: [],                // Array of { id, type, path, name, tree, selectedTree, collapsedFolders, dependencyGraph }
  currentDirectoryId: null,       // ID of the currently displayed directory
  userInstructions: "No instructions provided.",
  debounceTimer: null,            // Debounce timer reference
  selectedPrompts: new Set(),     // Track selected prompt names
  baseEndpoint: "/",              // Base endpoint URL set to relative root
  failedFiles: new Set(),         // Track files that failed to fetch
  whitelist: new Set(defaultWhitelist), // Whitelist of allowed file extensions
  // Removed eventSource and eventSourceRetries
};

/**
 * Saves the current application state.
 * Small properties are saved in localStorage; larger objects (directories, failed files) are saved in IndexedDB.
 */
export async function saveStateToLocalStorage() {
  localStorage.setItem(STORAGE_KEYS.ENDPOINT_URL, state.baseEndpoint);
  localStorage.setItem(STORAGE_KEYS.PROMPT_SELECTION, JSON.stringify([...state.selectedPrompts]));
  localStorage.setItem(STORAGE_KEYS.USER_INSTRUCTIONS, state.userInstructions);
  localStorage.setItem(STORAGE_KEYS.WHITELIST, JSON.stringify([...state.whitelist]));

  // Save larger state items to IndexedDB
  await setDirectories(state.directories);
  await setState(STORAGE_KEYS.FAILED_FILES, [...state.failedFiles]);
}

/**
 * Loads the application state.
 * Small properties are loaded from localStorage; larger objects (directories, failed files) are loaded from IndexedDB.
 */
export async function loadStateFromLocalStorage() {
  const savedEndpoint = localStorage.getItem(STORAGE_KEYS.ENDPOINT_URL);
  if (savedEndpoint) {
    state.baseEndpoint = savedEndpoint;
  } else if (window.location.protocol.startsWith('http')) {
    // If no endpoint is saved, default to the current page's origin.
    state.baseEndpoint = window.location.origin;
  }

  const savedPrompts = localStorage.getItem(STORAGE_KEYS.PROMPT_SELECTION);
  if (savedPrompts) {
    try {
      const parsedPrompts = JSON.parse(savedPrompts);
      state.selectedPrompts = new Set(Array.isArray(parsedPrompts) ? parsedPrompts : []);
    } catch (error) {
      console.error('Failed to parse saved prompts:', error.message);
      state.selectedPrompts = new Set();
    }
  } else {
    state.selectedPrompts = new Set();
  }
  state.userInstructions = localStorage.getItem(STORAGE_KEYS.USER_INSTRUCTIONS) || state.userInstructions;
  const savedWhitelist = localStorage.getItem(STORAGE_KEYS.WHITELIST);
  if (savedWhitelist) {
    try {
      state.whitelist = new Set(JSON.parse(savedWhitelist));
    } catch (error) {
      console.error('Failed to parse saved whitelist:', error.message);
      state.whitelist = new Set(defaultWhitelist);
    }
  } else {
    state.whitelist = new Set(defaultWhitelist);
  }
  // Load directories from IndexedDB
  state.directories = await getDirectories();
  if (state.directories.length > 0) {
    state.currentDirectoryId = state.directories[0].id;
  }
  // Load failed files from IndexedDB
  const failedFiles = await getState(STORAGE_KEYS.FAILED_FILES);
  try {
    state.failedFiles = new Set(Array.isArray(failedFiles) ? failedFiles : []);
  } catch (error) {
    state.failedFiles = new Set();
  }
}
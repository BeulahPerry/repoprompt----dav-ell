// public/js/state.js
// Manages application state and persistence.
// We now persist large state properties (uploaded file tree, failed files, and file selections) in IndexedDB via stateDB.js.

import { getState, setState } from './stateDB.js';

export const STORAGE_KEYS = {
  DIRECTORY_PATH: 'repoPrompt_directoryPath',
  ENDPOINT_URL: 'repoPrompt_endpointUrl',
  PROMPT_SELECTION: 'repoPrompt_promptSelection',
  FILE_SELECTION: 'repoPrompt_fileSelection',
  COLLAPSED_FOLDERS: 'repoPrompt_collapsedFolders',
  UPLOADED_FILE_TREE: 'repoPrompt_uploadedFileTree',
  FAILED_FILES: 'repoPrompt_failedFiles',
  USER_INSTRUCTIONS: 'repoPrompt_userInstructions',
  WHITELIST: 'repoPrompt_whitelist'
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
  selectedTree: {},               // Current selected file tree (object for proper nesting)
  collapsedFolders: new Set(),    // Track collapsed folder paths
  userInstructions: "No instructions provided.",
  debounceTimer: null,            // Debounce timer reference
  selectedPrompts: new Set(),     // Track selected prompt names
  rootDirectory: null,            // Current directory path
  baseEndpoint: "http://localhost:3000", // Base endpoint URL
  uploadedFileTree: null,         // File tree from uploaded zip (if any)
  failedFiles: new Set(),         // Track files that failed to fetch
  whitelist: new Set(defaultWhitelist) // New whitelist property
};

/**
 * Saves the current application state.
 * Small properties are saved in localStorage; larger objects are saved in IndexedDB.
 */
export async function saveStateToLocalStorage() {
  localStorage.setItem(STORAGE_KEYS.DIRECTORY_PATH, state.rootDirectory || '');
  localStorage.setItem(STORAGE_KEYS.ENDPOINT_URL, state.baseEndpoint);
  localStorage.setItem(STORAGE_KEYS.PROMPT_SELECTION, JSON.stringify([...state.selectedPrompts]));
  localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify([...state.collapsedFolders]));
  localStorage.setItem(STORAGE_KEYS.USER_INSTRUCTIONS, state.userInstructions);
  localStorage.setItem(STORAGE_KEYS.WHITELIST, JSON.stringify([...state.whitelist]));

  // Save larger state items to IndexedDB
  await setState(STORAGE_KEYS.UPLOADED_FILE_TREE, state.uploadedFileTree || {});
  await setState(STORAGE_KEYS.FAILED_FILES, [...state.failedFiles]);
  // FILE_SELECTION is now managed in fileTree.js via IndexedDB.
}

/**
 * Loads the application state.
 * Small properties are loaded from localStorage; larger objects are loaded from IndexedDB.
 */
export async function loadStateFromLocalStorage() {
  const savedDirectory = localStorage.getItem(STORAGE_KEYS.DIRECTORY_PATH);
  if (savedDirectory) {
    state.rootDirectory = savedDirectory;
  }
  const savedEndpoint = localStorage.getItem(STORAGE_KEYS.ENDPOINT_URL);
  if (savedEndpoint) {
    state.baseEndpoint = savedEndpoint;
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
  const savedCollapsed = localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS);
  if (savedCollapsed) {
    try {
      state.collapsedFolders = new Set(JSON.parse(savedCollapsed));
    } catch (error) {
      console.error('Failed to parse saved collapsed folders:', error.message);
      state.collapsedFolders = new Set();
    }
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
  // Load larger state items from IndexedDB
  const uploadedTree = await getState(STORAGE_KEYS.UPLOADED_FILE_TREE);
  state.uploadedFileTree = (uploadedTree && Object.keys(uploadedTree).length > 0) ? uploadedTree : null;
  const failedFiles = await getState(STORAGE_KEYS.FAILED_FILES);
  try {
    state.failedFiles = new Set(Array.isArray(failedFiles) ? failedFiles : []);
  } catch (error) {
    state.failedFiles = new Set();
  }
}
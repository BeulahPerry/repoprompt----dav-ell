// public/js/state.js
// Manages application state and localStorage persistence.

export const STORAGE_KEYS = {
  DIRECTORY_PATH: 'repoPrompt_directoryPath',
  ENDPOINT_URL: 'repoPrompt_endpointUrl',
  PROMPT_SELECTION: 'repoPrompt_promptSelection',
  FILE_SELECTION: 'repoPrompt_fileSelection',
  COLLAPSED_FOLDERS: 'repoPrompt_collapsedFolders',
  UPLOADED_FILE_TREE: 'repoPrompt_uploadedFileTree',
  UPLOADED_FILES: 'repoPrompt_uploadedFiles',
  FAILED_FILES: 'repoPrompt_failedFiles' // Added for failed file tracking
};

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
  uploadedFiles: {},              // Mapping from file path to file content from uploaded zip
  failedFiles: new Set()          // Track files that failed to fetch
};

/**
 * Saves the current application state to localStorage.
 */
export function saveStateToLocalStorage() {
  localStorage.setItem(STORAGE_KEYS.DIRECTORY_PATH, state.rootDirectory || '');
  localStorage.setItem(STORAGE_KEYS.ENDPOINT_URL, state.baseEndpoint);
  localStorage.setItem(STORAGE_KEYS.PROMPT_SELECTION, JSON.stringify([...state.selectedPrompts]));
  localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify([...state.collapsedFolders]));
  localStorage.setItem(STORAGE_KEYS.UPLOADED_FILE_TREE, JSON.stringify(state.uploadedFileTree || {}));
  localStorage.setItem(STORAGE_KEYS.UPLOADED_FILES, JSON.stringify(state.uploadedFiles || {}));
  localStorage.setItem(STORAGE_KEYS.FAILED_FILES, JSON.stringify([...state.failedFiles]));
}

/**
 * Loads the application state from localStorage.
 */
export function loadStateFromLocalStorage() {
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
  const savedUploadedTree = localStorage.getItem(STORAGE_KEYS.UPLOADED_FILE_TREE);
  if (savedUploadedTree) {
    try {
      const tree = JSON.parse(savedUploadedTree);
      state.uploadedFileTree = Object.keys(tree).length > 0 ? tree : null;
    } catch (error) {
      console.error('Failed to parse uploaded file tree:', error.message);
      state.uploadedFileTree = null;
    }
  }
  const savedUploadedFiles = localStorage.getItem(STORAGE_KEYS.UPLOADED_FILES);
  if (savedUploadedFiles) {
    try {
      state.uploadedFiles = JSON.parse(savedUploadedFiles);
    } catch (error) {
      console.error('Failed to parse uploaded files:', error.message);
      state.uploadedFiles = {};
    }
  }
  const savedFailedFiles = localStorage.getItem(STORAGE_KEYS.FAILED_FILES);
  if (savedFailedFiles) {
    try {
      state.failedFiles = new Set(JSON.parse(savedFailedFiles));
    } catch (error) {
      console.error('Failed to parse saved failed files:', error.message);
      state.failedFiles = new Set();
    }
  }
}
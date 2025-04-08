// public/js/explorer.js
// Manages the file explorer functionality by fetching directory contents from the server and updating the UI.

import { state, saveStateToLocalStorage } from './state.js';
import { renderFileExplorer } from './fileTreeRenderer.js';
import { updateXMLPreview } from './xmlPreview.js';
import { tryFetchWithFallback } from './connection.js';

/**
 * Generates the file explorer by fetching directory contents from the server for a specific directory and updating the UI.
 * @param {number} dirId - The ID of the directory to fetch and display.
 */
export async function generateFileExplorer(dirId) {
  const dir = state.directories.find(d => d.id === dirId);
  if (!dir) {
    console.error(`Directory with ID ${dirId} not found.`);
    return;
  }

  if (dir.type === 'uploaded') {
    renderFileExplorer();
    return;
  }

  if (!dir.path) {
    dir.error = 'No path specified for this directory';
    renderFileExplorer();
    return;
  }

  try {
    console.log(`Fetching directory: ${dir.path} from ${state.baseEndpoint}`);
    const url = `${state.baseEndpoint}/api/directory?path=${encodeURIComponent(dir.path)}`;
    const response = await tryFetchWithFallback(url);
    const data = await response.json();

    if (data.success) {
      dir.path = data.root; // Update with canonicalized path from server
      dir.tree = data.tree; // Assign the full tree structure
      delete dir.error; // Clear any previous error
      state.fileCache.clear(); // Clear cache when directory changes
      console.log('File explorer updated successfully with tree:', dir.tree);
      renderFileExplorer();
    } else {
      let errorMsg = data.error;
      if (errorMsg.includes("permission denied")) {
        errorMsg = `Permission denied: The server cannot access ${dir.path}. Ensure the server has read permissions.`;
      }
      dir.error = errorMsg;
      renderFileExplorer();
      console.error('Failed to load directory:', data.error);
    }
  } catch (error) {
    dir.error = `Network error - ${error.message}`;
    renderFileExplorer();
    console.error('Network error:', error.message);
  }
}
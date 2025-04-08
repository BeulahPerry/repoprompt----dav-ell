// public/js/explorer.js
// Manages the file explorer functionality by fetching directory contents from the server and updating the UI.

import { state, saveStateToLocalStorage } from './state.js';
import { renderFileTree, renderFileExplorer, applySavedFileSelections, buildAllSelectedTrees, getSelectedPaths } from './fileTree.js';
import { updateXMLPreview } from './xmlPreview.js';
import { tryFetchWithFallback } from './connection.js';

/**
 * Generates the file explorer by fetching directory contents from the server for a specific directory and updating the UI.
 * @param {number} dirId - The ID of the directory to fetch and display.
 */
export async function generateFileExplorer(dirId) {
  const fileListElement = document.getElementById('file-list');
  const dir = state.directories.find(d => d.id === dirId);
  if (!dir) {
    fileListElement.innerHTML = '<ul><li>Directory not found</li></ul>';
    return;
  }

  if (dir.type === 'uploaded') {
    renderFileExplorer();
    return;
  }

  // For 'path' type, use dir.path directly instead of relying on UI input
  if (!dir.path) {
    fileListElement.innerHTML = '<ul><li>No path specified for this directory</li></ul>';
    return;
  }

  fileListElement.innerHTML = '<ul><li>Loading...</li></ul>';

  try {
    console.log(`Fetching directory: ${dir.path} from ${state.baseEndpoint}`);
    const url = `${state.baseEndpoint}/api/directory?path=${encodeURIComponent(dir.path)}`;
    const response = await tryFetchWithFallback(url);
    const data = await response.json();

    if (data.success) {
      dir.path = data.root; // Update with canonicalized path from server
      dir.tree = data.tree; // Assign the full tree structure
      state.fileCache.clear(); // Clear cache when directory changes
      console.log('File explorer updated successfully with tree:', dir.tree);
      renderFileExplorer();
    } else {
      let errorMsg = data.error;
      if (errorMsg.includes("permission denied")) {
        errorMsg = `Permission denied: The server cannot access ${dir.path}. Ensure the server has read permissions.`;
      }
      fileListElement.innerHTML = `<ul><li>Error: ${errorMsg}</li></ul>`;
      console.error('Failed to load directory:', data.error);
    }
  } catch (error) {
    fileListElement.innerHTML = `<ul><li>Error: Network error - ${error.message}</li></ul>`;
    console.error('Network error:', error.message);
  }
}
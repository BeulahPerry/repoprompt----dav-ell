// public/js/explorer.js
// Manages the file explorer functionality by fetching directory contents from the server and updating the UI.

import { state, saveStateToLocalStorage } from './state.js';
import { renderFileTree, applySavedFileSelections, buildSelectedTree, getSelectedPaths } from './fileTree.js';
import { updateXMLPreview } from './xmlPreview.js';

/**
 * Generates the file explorer by fetching directory contents from the server.
 */
export async function generateFileExplorer() {
  const fileListElement = document.getElementById('file-list');
  if (!state.rootDirectory && !document.getElementById('directory-path').value.trim()) {
    fileListElement.innerHTML = '<ul><li>Please specify a directory path</li></ul>';
    return;
  }
  
  // Update state.rootDirectory from the input value.
  state.rootDirectory = document.getElementById('directory-path').value.trim();
  
  fileListElement.innerHTML = '<ul><li>Loading...</li></ul>';

  try {
    console.log(`Fetching directory: ${state.rootDirectory} from ${state.baseEndpoint}`);
    const response = await fetch(`${state.baseEndpoint}/api/directory?path=${encodeURIComponent(state.rootDirectory)}`);
    const data = await response.json();

    if (data.success) {
      state.rootDirectory = data.root;
      state.fileCache.clear(); // Clear cache when directory changes
      fileListElement.innerHTML = renderFileTree(data.tree, "", true);
      console.log('File explorer updated successfully');
      
      const savedSelections = localStorage.getItem('repoPrompt_fileSelection');
      if (savedSelections) {
        applySavedFileSelections(JSON.parse(savedSelections));
      } else {
        state.selectedTree = buildSelectedTree(fileListElement);
      }
      
      await updateXMLPreview(true); // Force full update on initial load
      
      const selectedPaths = getSelectedPaths(state.selectedTree);
      localStorage.setItem('repoPrompt_fileSelection', JSON.stringify(selectedPaths));
      saveStateToLocalStorage();
    } else {
      let errorMsg = data.error;
      if (errorMsg.includes("permission denied")) {
        errorMsg = `Permission denied: The server cannot access ${state.rootDirectory}. Ensure the server has read permissions.`;
      }
      fileListElement.innerHTML = `<ul><li>Error: ${errorMsg}</li></ul>`;
      console.error('Failed to load directory:', data.error);
    }
  } catch (error) {
    fileListElement.innerHTML = `<ul><li>Error: Network error - ${error.message}</li></ul>`;
    console.error('Network error:', error.message);
  }
}
// Manages the file explorer functionality by fetching directory contents from the server and updating the UI.

import { state, saveStateToLocalStorage } from './state.js';
import { renderFileExplorer } from './fileTreeRenderer.js';
import { updateXMLPreview } from './xmlPreview.js';
import { tryFetchWithFallback } from './connection.js';
import { updateDependencyGraph, showDependencySpinner, hideDependencySpinner } from './dependencyGraph.js';

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
    updateDependencyGraph();
    return;
  }

  if (!dir.path) {
    dir.error = 'No path specified for this directory';
    renderFileExplorer();
    updateDependencyGraph();
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
      dir.dependencyGraph = {}; // Initialize as empty, will be populated by async call
      delete dir.error; // Clear any previous error
      state.fileCache.clear(); // Clear cache when directory changes
      console.log('File explorer updated successfully with tree:', dir.tree);
      
      // Render file explorer immediately so the UI is usable
      renderFileExplorer();
      
      // Update graph with empty dependencies first (will hide the graph section)
      updateDependencyGraph();
      
      // Now fetch dependencies asynchronously without blocking the UI
      fetchDependenciesAsync(dir);
    } else {
      let errorMsg = data.error;
      if (errorMsg.includes("permission denied")) {
        errorMsg = `Permission denied: The server cannot access ${dir.path}. Ensure the server has read permissions.`;
      }
      dir.error = errorMsg;
      renderFileExplorer();
      console.error('Failed to load directory:', data.error);
      updateDependencyGraph();
    }
  } catch (error) {
    dir.error = `Network error - ${error.message}`;
    renderFileExplorer();
    console.error('Network error:', error.message);
    updateDependencyGraph();
  }
}

/**
 * Fetches dependencies asynchronously for a directory without blocking the UI.
 * Shows a spinner while loading and updates the graph when complete.
 * @param {object} dir - The directory object to fetch dependencies for.
 */
async function fetchDependenciesAsync(dir) {
  if (!dir.path) return;
  
  try {
    console.log(`Fetching dependencies for: ${dir.path}`);
    showDependencySpinner();
    
    const url = `${state.baseEndpoint}/api/dependencies?path=${encodeURIComponent(dir.path)}`;
    const response = await tryFetchWithFallback(url);
    const data = await response.json();
    
    if (data.success) {
      dir.dependencyGraph = data.dependencyGraph || {};
      console.log('Dependencies loaded successfully:', Object.keys(dir.dependencyGraph).length, 'files');
      
      // Update the dependency graph visualization with the new data
      updateDependencyGraph();
    } else {
      console.warn('Failed to load dependencies:', data.error);
      dir.dependencyGraph = {};
    }
  } catch (error) {
    console.warn('Error fetching dependencies:', error.message);
    dir.dependencyGraph = {};
  } finally {
    hideDependencySpinner();
  }
}
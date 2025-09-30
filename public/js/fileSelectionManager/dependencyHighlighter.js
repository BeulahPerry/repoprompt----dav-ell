// Manages highlighting of file dependencies in the file explorer UI.

import { state } from '../state.js';
import { getSelectedPaths } from './selectedTreeBuilder.js';

/**
 * Updates the UI to highlight files that are dependencies of the currently selected files.
 */
export function updateDependencyHighlights() {
  // Clear all existing dependency highlights first.
  document.querySelectorAll('li.dependency').forEach(li => {
    li.classList.remove('dependency');
    const indicator = li.querySelector('.dependency-indicator');
    if (indicator) {
      indicator.textContent = '';
      indicator.title = '';
    }
  });
  document.querySelectorAll('li[data-folder].has-dependency').forEach(li => {
    li.classList.remove('has-dependency');
  });

  // Gather all unique paths of selected files across all directories.
  const selectedPaths = new Set();
  state.directories.forEach(dir => {
    getSelectedPaths(dir.selectedTree).forEach(path => {
      selectedPaths.add(path);
    });
  });

  // Determine the map of dependencies: Map<dependencyPath, Set<importerPath>>
  const dependencyMap = new Map();
  state.directories.forEach(dir => {
    // Check if the directory has a dependency graph.
    if (!dir.dependencyGraph) return;

    // For each selected file, find its dependencies from the graph.
    selectedPaths.forEach(selectedPath => {
      if (dir.dependencyGraph[selectedPath]) {
        dir.dependencyGraph[selectedPath].forEach(depPath => {
          // A file is a dependency if it's not also directly selected by the user.
          if (!selectedPaths.has(depPath)) {
            if (!dependencyMap.has(depPath)) {
              dependencyMap.set(depPath, new Set());
            }
            dependencyMap.get(depPath).add(selectedPath);
          }
        });
      }
    });
  });

  // Apply the 'dependency' class to the corresponding file elements in the DOM.
  dependencyMap.forEach((importers, depPath) => {
    // Escape double quotes in path for the query selector.
    const escapedPath = depPath.replace(/"/g, '\\"');
    const fileLi = document.querySelector(`li[data-file="${escapedPath}"]`);
    if (fileLi) {
      fileLi.classList.add('dependency');
      const indicator = fileLi.querySelector('.dependency-indicator');
      if (indicator) {
        const importersArray = Array.from(importers);
        const importerNames = importersArray.map(p => p.split('/').pop());
        const firstImporterName = importerNames[0];

        indicator.textContent = firstImporterName;
        indicator.title = `Imported by: ${importerNames.join(', ')}`;

        if (importersArray.length > 1) {
          indicator.textContent += `, ...`;
        }
      }
      // Traverse up to highlight parent folders
      let parentFolderLi = fileLi.parentElement.closest('li[data-folder]');
      while (parentFolderLi) {
        parentFolderLi.classList.add('has-dependency');
        parentFolderLi = parentFolderLi.parentElement.closest('li[data-folder]');
      }
    }
  });
}
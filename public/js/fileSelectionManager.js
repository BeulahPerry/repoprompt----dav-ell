// Orchestrates file selection, UI updates, and state management.

import { state } from './state.js';
import { getState } from './stateDB.js';
import { updateXMLPreview } from './xmlPreview.js';
import { updateDependencyGraphSelection } from './dependencyGraph.js';
import { updateDependencyHighlights } from './fileSelectionManager/dependencyHighlighter.js';
import { buildAllSelectedTrees } from './fileSelectionManager/selectedTreeBuilder.js';
import { toggleFolderCollapse } from './fileSelectionManager/folderCollapse.js';
import { toggleFileSelection, toggleFolderSelection, updateAllFolderCheckboxes } from './fileSelectionManager/selectionLogic.js';

/**
 * Applies saved file selections to the file tree in the DOM for all directories.
 */
export async function applySavedFileSelections() {
  const fileList = document.getElementById('file-list');
  for (const dir of state.directories) {
    const dirIdStr = String(dir.id);
    const savedPaths = await getState(`repoPrompt_fileSelection_${dirIdStr}`);
    const paths = savedPaths ? JSON.parse(savedPaths) : [];
    const allItems = fileList.querySelectorAll(`li[data-dir-id="${dirIdStr}"][data-file]`);
    allItems.forEach(item => {
      const path = item.getAttribute('data-file');
      if (paths.includes(path) && item.getAttribute('data-text-file') === 'true') {
        const checkbox = item.querySelector('.file-checkbox');
        if (checkbox) {
          checkbox.checked = true;
          item.classList.add('selected');
        }
      }
    });
  }
  buildAllSelectedTrees();
  updateAllFolderCheckboxes();
  updateDependencyHighlights();
}

let heavyUpdateDebounceTimer = null;

/**
 * Performs all the heavy lifting after a selection change.
 * This includes building the selected tree, updating dependency visuals,
 * refreshing the XML preview, and recalculating the dependency graph layout.
 */
function performHeavyUpdates() {
    buildAllSelectedTrees();
    updateDependencyHighlights();
    updateXMLPreview(true);
    updateDependencyGraphSelection();
    import('./state.js').then(module => module.saveStateToLocalStorage());
}

/**
 * Schedules the heavy update operations, debouncing them to prevent
 * excessive re-calculations during rapid UI interactions.
 */
function scheduleHeavyUpdates() {
    clearTimeout(heavyUpdateDebounceTimer);
    heavyUpdateDebounceTimer = setTimeout(performHeavyUpdates, 200); // 200ms delay
}

/**
 * Handles file and folder selection and collapse/expand using event delegation
 * on the file list container.
 * Updates the selectedTree for the appropriate directory and refreshes the XML preview.
 * @param {Event} event - The click event.
 */
export function handleFileSelection(event) {
  const target = event.target;
  const li = target.closest('li[data-dir-id]');
  if (!li) return;

  const dirId = li.getAttribute('data-dir-id');
  const dir = state.directories.find(d => String(d.id) === dirId);
  if (!dir) {
    console.error(`Directory with ID ${dirId} not found in state.`);
    return;
  }

  state.failedFiles.clear();
  let selectionChanged = false;

  // Priority 1: Handle checkbox clicks for selection
  if (target.classList.contains('folder-checkbox')) {
    toggleFolderSelection(li, target.checked);
    selectionChanged = true;
  } else if (target.classList.contains('file-checkbox')) {
    toggleFileSelection(li, target.checked);
    selectionChanged = true;
  }
  // Priority 2: Handle clicks on the folder row for collapsing
  else if (target.closest('.folder-header')) {
    toggleFolderCollapse(li);
  }
  // Priority 3: Handle clicks on the file row for selection
  else if (target.closest('.file-header') && li.getAttribute('data-text-file') === 'true') {
    const checkbox = li.querySelector('.file-checkbox');
    if (checkbox) {
      toggleFileSelection(li, !checkbox.checked);
      selectionChanged = true;
    }
  }

  if (selectionChanged) {
    // Instead of running updates immediately, schedule them.
    scheduleHeavyUpdates();
  }
}
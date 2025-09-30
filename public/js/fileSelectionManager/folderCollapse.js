// Manages the collapse/expand state of folders in the file explorer.

import { state } from '../state.js';
import { propagateSelectionToVisibleChildren } from './selectionLogic.js';

/**
 * When a folder is expanded, this function ensures its children's UI state (checkboxes)
 * matches the folder's selection state (checked or unchecked). This is necessary because
 * UI updates are deferred for collapsed folders to improve performance.
 * @param {HTMLElement} li - The folder `li` element that was just expanded.
 */
function syncExpandedFolderState(li) {
  const folderCheckbox = li.querySelector(':scope > .folder-header > .folder-checkbox');
  // Only propagate state if the folder is fully checked or unchecked (not indeterminate).
  if (folderCheckbox && !folderCheckbox.indeterminate) {
    propagateSelectionToVisibleChildren(li, folderCheckbox.checked);
  }
}

/**
 * Toggles the collapse state of a folder.
 * @param {HTMLElement} li - The folder li element.
 */
export function toggleFolderCollapse(li) {
  const dirId = li.getAttribute('data-dir-id');
  const dir = state.directories.find(d => String(d.id) === dirId);
  if (!dir) return;

  const folderPath = li.getAttribute('data-folder');
  const isCollapsed = li.classList.contains('collapsed');

  if (isCollapsed) {
    li.classList.remove('collapsed');
    dir.collapsedFolders.delete(folderPath);
    // When expanding, sync children's UI state, as it may have changed
    // while the folder was collapsed. This is a key performance optimization.
    syncExpandedFolderState(li);
  } else {
    li.classList.add('collapsed');
    dir.collapsedFolders.add(folderPath);
  }
  import('../state.js').then(module => {
    module.saveStateToLocalStorage();
  });
}
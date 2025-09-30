// Handles file and folder selection, and manages the selected tree state.

import { state } from './state.js';
import { setState, getState } from './stateDB.js';
import { updateXMLPreview } from './xmlPreview.js';
import { isTextFile } from './utils.js';
import { updateDependencyGraphSelection } from './dependencyGraph.js';

/**
 * Updates the UI to highlight files that are dependencies of the currently selected files.
 */
function updateDependencyHighlights() {
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

/**
 * Builds selected trees for all directories based on the current UI state.
 */
export function buildAllSelectedTrees() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;

  state.directories.forEach(dir => {
    const dirIdStr = String(dir.id);
    const topLi = fileList.querySelector(`li[data-dir-id="${dirIdStr}"]`);
    if (topLi) {
      const ul = topLi.querySelector(':scope > ul');
      dir.selectedTree = ul ? buildSelectedTreeForDirectory(ul, dir.path, dir.id) : {};
      const selectedPaths = getSelectedPaths(dir.selectedTree);
      console.log(`Updated selectedTree for dir ${dirIdStr}:`, dir.selectedTree);
      setState(`repoPrompt_fileSelection_${dirIdStr}`, JSON.stringify(selectedPaths));
    } else {
      dir.selectedTree = {};
      const selectedPaths = [];
      console.log(`Cleared selectedTree for dir ${dirIdStr} (not found in DOM)`);
      setState(`repoPrompt_fileSelection_${dirIdStr}`, JSON.stringify(selectedPaths));
    }
  });
}

/**
 * Builds a selected file tree for a specific directory based on its DOM elements.
 * @param {HTMLElement} ulElement - The unordered list element containing file items.
 * @param {string} parentPath - The parent directory path (might be undefined for uploaded).
 * @param {string} dirId - The directory ID.
 * @returns {Object} - The selected file tree for the directory.
 */
function buildSelectedTreeForDirectory(ulElement, parentPath, dirId) {
  const tree = {};
  if (!ulElement) return tree;

  const liElements = ulElement.querySelectorAll(':scope > li');
  liElements.forEach(li => {
    if (li.hasAttribute("data-file")) {
      const checkbox = li.querySelector('.file-checkbox');
      if (checkbox && checkbox.checked && li.getAttribute('data-text-file') === 'true') {
        const filePath = li.getAttribute("data-file");
        const fileName = filePath.split("/").pop();
        tree[fileName] = { type: "file", path: filePath };
      }
    } else if (li.hasAttribute("data-folder")) {
      const folderPath = li.getAttribute("data-folder");
      const folderName = li.querySelector('.folder-name').textContent.trim();
      const checkbox = li.querySelector('.folder-checkbox');
      const nestedUl = li.querySelector(":scope > ul");
      const children = nestedUl ? buildSelectedTreeForDirectory(nestedUl, folderPath, dirId) : {};

      if (Object.keys(children).length > 0 || (checkbox && checkbox.checked)) {
        let finalChildren = children;
        if (checkbox && checkbox.checked) {
          const dir = state.directories.find(d => String(d.id) === String(dirId));
          const originalFolderNode = dir ? findNodeInTree(dir.tree, folderPath) : null;
          finalChildren = originalFolderNode ? { ...originalFolderNode.children } : children;
          finalChildren = addAllTextFilesFromNode(originalFolderNode, finalChildren);
        }
        tree[folderName] = { type: "folder", path: folderPath, children: finalChildren };
      }
    }
  });
  return tree;
}

/**
 * Helper function to ensure all text files from an original tree node are included
 * when a folder checkbox is fully checked.
 * @param {Object} originalNode - The node from the original full directory tree.
 * @param {Object} currentSelectedChildren - The children object being built.
 * @returns {Object} - The updated children object.
 */
function addAllTextFilesFromNode(originalNode, currentSelectedChildren) {
  if (!originalNode || !originalNode.children) {
    return currentSelectedChildren || {};
  }

  const updatedChildren = { ...(currentSelectedChildren || {}) };

  Object.entries(originalNode.children).forEach(([name, node]) => {
    if (node.type === 'file' && isTextFile(node.path)) {
      if (!updatedChildren[name]) {
        updatedChildren[name] = { type: "file", path: node.path };
      }
    } else if (node.type === 'folder') {
      if (updatedChildren[name] && updatedChildren[name].type === 'folder') {
        updatedChildren[name].children = addAllTextFilesFromNode(node, updatedChildren[name].children);
      } else if (!updatedChildren[name]) {
        updatedChildren[name] = {
          type: "folder",
          path: node.path,
          children: addAllTextFilesFromNode(node, {})
        };
      }
    }
  });

  return updatedChildren;
}

/**
 * Helper function to find a node in the tree by its path.
 * @param {Object} tree - The file tree object.
 * @param {string} path - The path to find.
 * @returns {Object|null} - The node if found, null otherwise.
 */
function findNodeInTree(tree, path) {
  if (!tree) return null;
  for (const [name, node] of Object.entries(tree)) {
    if (node.path === path) return node;
    if (node.type === "folder" && node.children) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recursively retrieves all selected file paths from the file tree object.
 * @param {Object} tree - The file tree object.
 * @returns {Array<string>} - Array of selected paths.
 */
export function getSelectedPaths(tree) {
  let paths = [];
  for (let key in tree) {
    const node = tree[key];
    if (node.type === 'file') {
      paths.push(node.path);
    } else if (node.type === 'folder' && node.children) {
      paths = paths.concat(getSelectedPaths(node.children));
    }
  }
  return paths;
}

/**
 * Toggles the collapse state of a folder.
 * Moved from fileTreeRenderer.js to break a circular dependency and co-locate UI logic.
 * @param {HTMLElement} li - The folder li element.
 */
function toggleFolderCollapse(li) {
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
  import('./state.js').then(module => {
    module.saveStateToLocalStorage();
  });
}

/**
 * Recursively propagates selection state to the UI of visible (expanded) children.
 * This is the core of the performance optimization, as it avoids manipulating the DOM
 * for children inside collapsed folders.
 * @param {HTMLElement} li - The parent folder `li` element.
 * @param {boolean} select - The selection state to propagate.
 */
function propagateSelectionToVisibleChildren(li, select) {
  if (li.classList.contains('collapsed')) {
    return; // Stop if folder is collapsed, as its children are not visible.
  }

  const childUl = li.querySelector(':scope > ul');
  if (!childUl) return;

  const childItems = childUl.querySelectorAll(':scope > li');
  childItems.forEach(childLi => {
    if (childLi.hasAttribute('data-file')) {
      const checkbox = childLi.querySelector('.file-checkbox');
      if (checkbox && !checkbox.disabled) {
        checkbox.checked = select;
        childLi.classList.toggle('selected', select);
      }
    } else if (childLi.hasAttribute('data-folder')) {
      const checkbox = childLi.querySelector('.folder-checkbox');
      if (checkbox) {
        checkbox.checked = select;
        checkbox.indeterminate = false;
      }
      // Recurse to handle nested expanded folders
      propagateSelectionToVisibleChildren(childLi, select);
    }
  });
}

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
 * Recursively selects or deselects all children (files and folders) of a folder LI element.
 * Updates checkbox states and 'selected' class for files. This is optimized to only
 * update visible children to prevent UI stutter with large, collapsed directories.
 * @param {HTMLElement} li - The folder li element.
 * @param {boolean} select - Whether to select or deselect.
 */
function toggleFolderSelection(li, select) {
  console.log(`Toggling folder ${li.getAttribute('data-folder')} to ${select}`);

  // Update the state of the folder that was clicked. This is fast.
  const checkbox = li.querySelector('.folder-checkbox');
  if (checkbox) {
    checkbox.checked = select;
    checkbox.indeterminate = false;
  }

  // Visually update any children that are currently visible.
  // This is the main performance optimization: collapsed subtrees are not touched.
  propagateSelectionToVisibleChildren(li, select);

  // Update the state of parent folders up the tree.
  updateParentFolders(li);
}


/**
 * Toggles selection of a single file.
 * @param {HTMLElement} li - The file li element.
 * @param {boolean} select - Whether to select or deselect.
 */
function toggleFileSelection(li, select) {
  console.log(`Toggling file ${li.getAttribute('data-file')} to ${select}`);
  const checkbox = li.querySelector('.file-checkbox');
  if (checkbox && !checkbox.disabled) {
    checkbox.checked = select;
    li.classList.toggle('selected', select);
    updateParentFolders(li);
  }
}

/**
 * Updates the checkbox states (checked, indeterminate) of all parent folders
 * up the DOM tree until the main file-list or another directory root.
 * @param {HTMLElement} li - The starting li element (file or folder).
 */
function updateParentFolders(li) {
  let currentLi = li.parentElement.closest('li[data-folder]');
  while (currentLi) {
    updateFolderCheckbox(currentLi);
    currentLi = currentLi.parentElement.closest('li[data-folder]');
  }
}

/**
 * Updates a folder's checkbox state (checked, indeterminate, unchecked) based on the
 * selection state of its immediate children (files and subfolders).
 * @param {HTMLElement} li - The folder li element to update.
 */
function updateFolderCheckbox(li) {
  const folderCheckbox = li.querySelector(':scope > .folder-header > .folder-checkbox');
  if (!folderCheckbox) return;

  const childUl = li.querySelector(':scope > ul');
  if (!childUl) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
    return;
  }

  const childFileLis = childUl.querySelectorAll(':scope > li[data-file]');
  const childSubfolderLis = childUl.querySelectorAll(':scope > li[data-folder]');

  let allChildrenSelected = true;
  let someChildrenSelected = false;
  let hasSelectableChildren = false;

  childFileLis.forEach(fileLi => {
    const fileCheckbox = fileLi.querySelector('.file-checkbox');
    if (fileCheckbox && !fileCheckbox.disabled) {
      hasSelectableChildren = true;
      if (fileCheckbox.checked) {
        someChildrenSelected = true;
      } else {
        allChildrenSelected = false;
      }
    }
  });

  childSubfolderLis.forEach(subLi => {
    hasSelectableChildren = true;
    const subCheckbox = subLi.querySelector(':scope > .folder-header > .folder-checkbox');
    if (subCheckbox) {
      if (subCheckbox.checked) {
        someChildrenSelected = true;
      } else if (subCheckbox.indeterminate) {
        someChildrenSelected = true;
        allChildrenSelected = false;
      } else {
        allChildrenSelected = false;
      }
    }
  });

  if (!hasSelectableChildren) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
  } else if (allChildrenSelected) {
    folderCheckbox.checked = true;
    folderCheckbox.indeterminate = false;
  } else if (someChildrenSelected) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = true;
  } else {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
  }
}

/**
 * Updates all folder checkboxes starting from the top level directories
 * down the hierarchy based on their children's states.
 */
export function updateAllFolderCheckboxes() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;
  const allFolderLis = fileList.querySelectorAll('li[data-folder]');
  Array.from(allFolderLis).reverse().forEach(folderLi => {
    updateFolderCheckbox(folderLi);
  });
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
// public/js/fileTree.js
// Handles rendering of the file tree, file/folder selection, and toggling collapse/expand.

import { state } from './state.js';
import { updateXMLPreview } from './xmlPreview.js';
import { sortTreeEntries, isTextFile } from './utils.js';
import { setState, getState } from './stateDB.js';

/**
 * Recursively renders the file tree into an HTML unordered list with checkboxes for a specific directory.
 * @param {Object} tree - The file tree object for the directory.
 * @param {Object} selectedTree - The selected tree object for the directory.
 * @param {Set<string>} collapsedFolders - Set of collapsed folder paths for the directory.
 * @param {string} dirId - The unique identifier of the directory.
 * @param {string} parentPath - The parent path.
 * @param {boolean} isRoot - Flag indicating whether to wrap in <ul> or not.
 * @returns {string} - The HTML string representing the file tree.
 */
export function renderFileTree(tree, selectedTree, collapsedFolders, dirId, parentPath = "", isRoot = false) {
  let html = isRoot ? "" : '<ul>';
  
  const entries = Object.entries(tree).map(([name, node]) => ({
    name,
    type: node.type,
    path: node.path,
    children: node.children
  }));
  const sortedEntries = sortTreeEntries(entries);

  for (const entry of sortedEntries) {
    if (entry.type === "file") {
      const isText = isTextFile(entry.path);
      const isSelected = !!selectedTree[entry.name];
      html += `<li data-file="${entry.path}" data-text-file="${isText}" data-dir-id="${dirId}" title="${entry.path}">`;
      html += `<div class="file-header">`;
      html += `<input type="checkbox" class="file-checkbox" ${isText ? '' : 'disabled'} ${isSelected ? 'checked' : ''}>`;
      html += `<span class="file-name">${entry.name}</span>`;
      html += `</div></li>`;
    } else if (entry.type === "folder") {
      const folderPath = entry.path;
      const isCollapsed = collapsedFolders.has(folderPath);
      html += `<li data-folder="${folderPath}" data-dir-id="${dirId}" class="${isCollapsed ? 'collapsed' : ''}" title="${folderPath}">`;
      html += `<div class="folder-header">`;
      html += `<input type="checkbox" class="folder-checkbox">`;
      html += `<span class="folder-toggle"></span>`;
      html += `<span class="folder-name">${entry.name}</span>`;
      html += `</div>`;
      // Pass down the relevant part of the selected tree for rendering children
      const childSelectedTree = selectedTree[entry.name]?.children || {};
      html += renderFileTree(entry.children, childSelectedTree, collapsedFolders, dirId, folderPath, false);
      html += `</li>`;
    }
  }
  html += isRoot ? "" : '</ul>';
  return html;
}

/**
 * Renders the file explorer with all directories as top-level expandable/collapsible folders.
 */
export function renderFileExplorer() {
  const fileListElement = document.getElementById('file-list');
  let html = '<ul>';
  state.directories.forEach(dir => {
    const dirName = dir.name || (dir.path ? dir.path.split('/').pop() : `dir-${dir.id}`);
    const dirIdentifier = dir.path || `dir-${dir.id}`; // Use path or a unique ID for data-folder
    const isCollapsed = dir.collapsedFolders.has(dirIdentifier);
    html += `<li data-folder="${dirIdentifier}" data-dir-id="${dir.id}" class="${isCollapsed ? 'collapsed' : ''}" title="${dirIdentifier}">`;
    html += `<div class="folder-header">`;
    html += `<input type="checkbox" class="folder-checkbox">`;
    html += `<span class="folder-toggle"></span>`;
    html += `<span class="folder-name">${dirName}</span>`;
    html += `</div>`;
    html += renderFileTree(dir.tree, dir.selectedTree, dir.collapsedFolders, dir.id, dirIdentifier, false);
    html += `</li>`;
  });
  html += '</ul>';
  fileListElement.innerHTML = html;
  applySavedFileSelections();
  updateAllFolderCheckboxes();
  updateXMLPreview(true);
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
    } else if (node.type === 'folder' && node.children) { // Check if children exist
      // Note: We don't add the folder path itself here, only file paths
      paths = paths.concat(getSelectedPaths(node.children));
    }
  }
  return paths;
}


/**
 * Applies saved file selections to the file tree in the DOM for all directories.
 */
export async function applySavedFileSelections() {
  const fileList = document.getElementById('file-list');
  for (const dir of state.directories) {
    // Ensure dir.id is treated as a string for consistency with attributes
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
            item.classList.add('selected'); // Ensure class is added
        }
      }
    });
  }
  buildAllSelectedTrees(); // Build selected tree based on initial state
  updateAllFolderCheckboxes(); // Update folder states after applying selections
  // updateXMLPreview(true); // updateXMLPreview is called by renderFileExplorer which calls this
}


/**
 * Builds selected trees for all directories based on the current UI state.
 */
export function buildAllSelectedTrees() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return; // Guard against missing element

  state.directories.forEach(dir => {
    const dirIdStr = String(dir.id); // Ensure string comparison
    const topLi = fileList.querySelector(`li[data-dir-id="${dirIdStr}"]`); // Get the top-level LI for this directory

    if (topLi) {
        const ul = topLi.querySelector(':scope > ul');
        dir.selectedTree = ul ? buildSelectedTreeForDirectory(ul, dir.path, dir.id) : {}; // Pass dir.id
        // No need to check topLi checkbox - buildSelectedTreeForDirectory handles selections inside
        const selectedPaths = getSelectedPaths(dir.selectedTree);
        console.log(`Updated selectedTree for dir ${dirIdStr}:`, dir.selectedTree);
        setState(`repoPrompt_fileSelection_${dirIdStr}`, JSON.stringify(selectedPaths));
    } else {
        // If the top-level LI isn't found (e.g., after removing a directory), clear its selectedTree
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
export function buildSelectedTreeForDirectory(ulElement, parentPath, dirId) {
  const tree = {};
  if (!ulElement) return tree; // Guard clause

  const liElements = ulElement.querySelectorAll(':scope > li');
  liElements.forEach(li => {
    if (li.hasAttribute("data-file")) {
      const checkbox = li.querySelector('.file-checkbox');
      // Include file if its checkbox is checked and it's a text file
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
        // Pass dirId down recursively
      const children = nestedUl ? buildSelectedTreeForDirectory(nestedUl, folderPath, dirId) : {};

        // Include folder only if it has selected children OR its own checkbox is checked
      if (Object.keys(children).length > 0 || (checkbox && checkbox.checked)) {
            // If folder checkbox is checked, we need the *original* children structure to include everything
            // Otherwise, we only include the children that were selected recursively
            let finalChildren = children;
            if (checkbox && checkbox.checked) {
                 const dir = state.directories.find(d => String(d.id) === String(dirId)); // Compare as strings
                 const originalFolderNode = dir ? findNodeInTree(dir.tree, folderPath) : null;
                 // If the original folder node exists, use its children structure,
                 // otherwise fallback to the recursively built children (handles partial selections better)
                 finalChildren = originalFolderNode ? { ...originalFolderNode.children } : children;
                 // Ensure all files within the fully checked folder are added (respecting text-file check)
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
            // Add file if it's not already there (might be added by recursive buildSelectedTree)
            if (!updatedChildren[name]) {
                 updatedChildren[name] = { type: "file", path: node.path };
            }
        } else if (node.type === 'folder') {
            // If folder exists in updatedChildren, ensure its children are also checked recursively
            if (updatedChildren[name] && updatedChildren[name].type === 'folder') {
                updatedChildren[name].children = addAllTextFilesFromNode(node, updatedChildren[name].children);
            } else if (!updatedChildren[name]) {
                 // If folder doesn't exist in updatedChildren, add it and all its text files
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
  if (!tree) return null; // Add guard for empty/null tree
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
 * Recursively formats a file tree object into a string with branch symbols.
 * @param {Object} tree - The file tree object.
 * @param {string} prefix - The current prefix for formatting.
 * @returns {Array<string>} - An array of strings representing the file tree.
 */
export function formatTree(tree, prefix = "") {
  let lines = [];
  const entries = Object.entries(tree);
  entries.forEach(([name, node], index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "└── " : "├── ";
    lines.push(prefix + branch + name);
    if (node.type === "folder" && node.children && Object.keys(node.children).length > 0) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      lines = lines.concat(formatTree(node.children, newPrefix));
    }
  });
  return lines;
}

/**
 * Recursively selects or deselects all children (files and folders) of a folder LI element.
 * Updates checkbox states and 'selected' class for files.
 * @param {HTMLElement} li - The folder li element.
 * @param {boolean} select - Whether to select or deselect.
 */
function toggleFolderSelection(li, select) {
  console.log(`Toggling folder ${li.getAttribute('data-folder')} to ${select}`);
  // Find all descendant file LIs within this folder LI's UL
  const fileLis = li.querySelectorAll(':scope > ul li[data-file]');
  fileLis.forEach(fileLi => {
    const checkbox = fileLi.querySelector('.file-checkbox');
    // Only toggle enabled checkboxes (text files)
    if (checkbox && !checkbox.disabled) {
      checkbox.checked = select;
      fileLi.classList.toggle('selected', select); // Add/remove 'selected' class
    }
  });

  // Find all descendant folder LIs within this folder LI's UL
  const subfolderLis = li.querySelectorAll(':scope > ul li[data-folder]');
  subfolderLis.forEach(subLi => {
    const checkbox = subLi.querySelector('.folder-checkbox');
    if (checkbox) {
      checkbox.checked = select;
      checkbox.indeterminate = false; // A fully selected/deselected folder is not indeterminate
      // No recursive call needed here as querySelectorAll handles descendants
    }
  });

  // Update the state of parent folders after toggling children
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
    li.classList.toggle('selected', select); // Add/remove 'selected' class
    // Update the state of parent folders after toggling a file
    updateParentFolders(li);
  }
}

/**
 * Updates the checkbox states (checked, indeterminate) of all parent folders
 * up the DOM tree until the main file-list or another directory root.
 * @param {HTMLElement} li - The starting li element (file or folder).
 */
function updateParentFolders(li) {
  // Start from the parent UL, then find the closest parent LI (which is the folder containing the item)
  let currentLi = li.parentElement.closest('li[data-folder]');
  while (currentLi) {
    updateFolderCheckbox(currentLi);
    // Move up to the next parent folder
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
  if (!folderCheckbox) return; // Should not happen

  // Find direct children UL
  const childUl = li.querySelector(':scope > ul');
  if (!childUl) { // Folder has no children displayed (or is empty)
      folderCheckbox.checked = false;
      folderCheckbox.indeterminate = false;
      return;
  }

  // Get direct child file and folder LIs
  const childFileLis = childUl.querySelectorAll(':scope > li[data-file]');
  const childSubfolderLis = childUl.querySelectorAll(':scope > li[data-folder]');

  let allChildrenSelected = true;
  let someChildrenSelected = false;
  let hasSelectableChildren = false; // Track if there are any children that *can* be selected

  // Check state of direct child files
  childFileLis.forEach(fileLi => {
    const fileCheckbox = fileLi.querySelector('.file-checkbox');
    if (fileCheckbox && !fileCheckbox.disabled) { // Only consider text files
      hasSelectableChildren = true;
      if (fileCheckbox.checked) {
        someChildrenSelected = true;
      } else {
        allChildrenSelected = false;
      }
    }
  });

  // Check state of direct child folders
  childSubfolderLis.forEach(subLi => {
    hasSelectableChildren = true; // A subfolder itself counts as a selectable child
    const subCheckbox = subLi.querySelector(':scope > .folder-header > .folder-checkbox');
    if (subCheckbox) {
        if (subCheckbox.checked) {
            someChildrenSelected = true; // Fully checked subfolder counts as selected
        } else if (subCheckbox.indeterminate) {
            someChildrenSelected = true; // Partially selected subfolder counts as selected
            allChildrenSelected = false;
        } else {
            allChildrenSelected = false; // Unchecked subfolder means not all are selected
        }
    }
  });

  // Determine the state of the current folder's checkbox
  if (!hasSelectableChildren) { // No selectable children (e.g., folder with only binary files)
      folderCheckbox.checked = false;
      folderCheckbox.indeterminate = false;
  } else if (allChildrenSelected) {
    folderCheckbox.checked = true;
    folderCheckbox.indeterminate = false;
  } else if (someChildrenSelected) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = true;
  } else { // No children selected
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
  }
}


/**
 * Updates all folder checkboxes starting from the top level directories
 * down the hierarchy based on their children's states. Necessary after initial load
 * or significant tree changes.
 */
function updateAllFolderCheckboxes() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;
  const topLevelFolderLis = fileList.querySelectorAll(':scope > ul > li[data-folder]');
  // We need to update from bottom-up to ensure parent state is correct.
  // Easiest way is to get all folders and update them. The update logic
  // inherently checks children, so order doesn't strictly matter as long
  // as all are eventually updated.
  const allFolderLis = fileList.querySelectorAll('li[data-folder]');
  // Convert NodeList to Array and reverse it to process deepest folders first
  Array.from(allFolderLis).reverse().forEach(folderLi => {
      updateFolderCheckbox(folderLi);
  });
}


/**
 * Toggles the collapse state of a folder within its specific directory.
 * @param {HTMLElement} li - The folder li element.
 */
export function toggleFolderCollapse(li) {
  const dirId = li.getAttribute('data-dir-id');
  const dir = state.directories.find(d => String(d.id) === dirId); // Compare as string
  if (!dir) return;

  const folderPath = li.getAttribute('data-folder');
  const isCollapsed = li.classList.contains('collapsed');

  if (isCollapsed) {
    li.classList.remove('collapsed');
    dir.collapsedFolders.delete(folderPath);
  } else {
    li.classList.add('collapsed');
    dir.collapsedFolders.add(folderPath);
  }
  import('./state.js').then(module => {
    module.saveStateToLocalStorage(); // Save collapse state
  });
}

/**
 * Handles file and folder selection and collapse/expand using event delegation
 * on the file list container.
 * Updates the selectedTree for the appropriate directory and refreshes the XML preview.
 * @param {Event} event - The click event.
 */
export function handleFileSelection(event) {
  const target = event.target;
  const li = target.closest('li[data-dir-id]'); // Ensure the LI has a directory ID
  if (!li) return;

  const dirId = li.getAttribute('data-dir-id');
  const dir = state.directories.find(d => String(d.id) === dirId); // Compare as string
  if (!dir) {
      console.error(`Directory with ID ${dirId} not found in state.`);
      return;
  }

  state.failedFiles.clear(); // Clear failed files on any selection change

  let selectionChanged = false;

  if (target.classList.contains('folder-checkbox')) {
    // Handle folder checkbox click
    const checkbox = target;
    toggleFolderSelection(li, checkbox.checked);
    selectionChanged = true;
  } else if (target.classList.contains('file-checkbox')) {
    // Handle file checkbox click
    const checkbox = target;
    toggleFileSelection(li, checkbox.checked);
    selectionChanged = true;
  } else if (target.classList.contains('folder-toggle') || target.classList.contains('folder-name')) {
    // Handle folder expand/collapse click
    // Check if the click was directly on the checkbox inside the header
    const isCheckboxClick = target.closest('.folder-header').querySelector('.folder-checkbox')?.contains(target);
    if (!isCheckboxClick) { // Only toggle collapse if not clicking the checkbox
        toggleFolderCollapse(li);
    }
  } else if (target.classList.contains('file-name') && li.getAttribute('data-text-file') === 'true') {
    // Handle file name click (toggle selection)
    const checkbox = li.querySelector('.file-checkbox');
    if (checkbox) { // Ensure checkbox exists
        toggleFileSelection(li, !checkbox.checked);
        selectionChanged = true;
    }
  }

  // Only rebuild tree and update preview if a selection actually changed
  if (selectionChanged) {
      buildAllSelectedTrees();
      console.log('After selection, state.directories:', JSON.parse(JSON.stringify(state.directories))); // Deep log
      updateXMLPreview(true); // Force update to fetch content if needed

      // Save the overall application state (includes selections via buildAllSelectedTrees->setState)
      import('./state.js').then(module => module.saveStateToLocalStorage());
      document.dispatchEvent(new Event('fileSelectionChanged')); // Notify for potential SSE updates
  }
}
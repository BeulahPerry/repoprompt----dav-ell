// public/js/fileTree.js
// Handles rendering of the file tree, file/folder selection, and toggling collapse/expand.

import { state } from './state.js';
import { updateXMLPreview } from './xmlPreview.js';
import { sortTreeEntries, isTextFile } from './utils.js';
import { generateFileExplorer } from './explorer.js';
import { setState, getState } from './stateDB.js';

/**
 * Recursively renders the file tree into an HTML unordered list with checkboxes.
 * @param {Object} tree - The file tree object.
 * @param {string} parentPath - The parent path.
 * @param {boolean} isRoot - Flag indicating whether to wrap in <ul> or not.
 * @returns {string} - The HTML string representing the file tree.
 */
export function renderFileTree(tree, parentPath = "", isRoot = false) {
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
      const isSelected = !!state.selectedTree[entry.name]; // Simplified check
      html += `<li data-file="${entry.path}" data-text-file="${isText}" title="${entry.path}">`;
      html += `<div class="file-header">`;
      html += `<input type="checkbox" class="file-checkbox" ${isText ? '' : 'disabled'} ${isSelected ? 'checked' : ''}>`;
      html += `<span class="file-name">${entry.name}</span>`;
      html += `</div></li>`;
    } else if (entry.type === "folder") {
      const folderPath = entry.path;
      const isCollapsed = state.collapsedFolders.has(folderPath) || state.collapsedFolders.size === 0;
      html += `<li data-folder="${folderPath}" class="${isCollapsed ? 'collapsed' : ''}" title="${folderPath}">`;
      html += `<div class="folder-header">`;
      html += `<input type="checkbox" class="folder-checkbox">`;
      html += `<span class="folder-toggle"></span>`; // Removed +/-
      html += `<span class="folder-name">${entry.name}</span>`;
      html += `</div>`;
      html += renderFileTree(entry.children, folderPath);
      html += `</li>`;
    }
  }
  html += isRoot ? "" : '</ul>';
  return html;
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
    } else if (node.type === 'folder') {
      paths.push(node.path);
      paths = paths.concat(getSelectedPaths(node.children));
    }
  }
  return paths;
}

/**
 * Applies saved file selections to the file tree in the DOM.
 * @param {string[]} savedPaths - Array of paths to select.
 */
export async function applySavedFileSelections(savedPaths) {
  if (!savedPaths) {
    const stored = await getState('repoPrompt_fileSelection');
    savedPaths = stored ? JSON.parse(stored) : [];
  }
  
  const fileList = document.getElementById('file-list');
  const allItems = fileList.querySelectorAll('li[data-file]');
  
  allItems.forEach(item => {
    const path = item.getAttribute('data-file');
    if (savedPaths.includes(path) && item.getAttribute('data-text-file') === 'true') {
      item.classList.add('selected');
      const checkbox = item.querySelector('.file-checkbox');
      if (checkbox) checkbox.checked = true;
    }
  });

  updateAllFolderCheckboxes();
  state.selectedTree = buildSelectedTree(fileList);
}

/**
 * Builds a file tree based on selected items in the file explorer.
 * @param {HTMLElement} ulElement - The unordered list element containing file items.
 * @param {string} parentPath - The parent directory path.
 * @returns {Object} - The selected file tree.
 */
export function buildSelectedTree(ulElement, parentPath = state.rootDirectory) {
  const tree = {};
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
      const nestedUl = li.querySelector(":scope > ul");
      const children = nestedUl ? buildSelectedTree(nestedUl, folderPath) : {};
      if (Object.keys(children).length > 0) {
        tree[folderName] = { type: "folder", path: folderPath, children };
      }
    }
  });
  return tree;
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
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      lines = lines.concat(formatTree(node.children, newPrefix));
    }
  });
  return lines;
}

/**
 * Recursively selects or deselects all children of a folder.
 * @param {HTMLElement} li - The folder li element.
 * @param {boolean} select - Whether to select or deselect.
 */
function toggleFolderSelection(li, select) {
  const fileLis = li.querySelectorAll(':scope ul li[data-file]');
  fileLis.forEach(fileLi => {
    const checkbox = fileLi.querySelector('.file-checkbox');
    if (checkbox && !checkbox.disabled) {
      checkbox.checked = select;
      fileLi.classList.toggle('selected', select);
    }
  });
  const subfolderLis = li.querySelectorAll(':scope ul li[data-folder]');
  subfolderLis.forEach(subLi => {
    const checkbox = subLi.querySelector('.folder-checkbox');
    checkbox.checked = select;
    checkbox.indeterminate = false;
  });
  updateParentFolders(li);
}

/**
 * Toggles selection of a single file.
 * @param {HTMLElement} li - The file li element.
 * @param {boolean} select - Whether to select or deselect.
 */
function toggleFileSelection(li, select) {
  const checkbox = li.querySelector('.file-checkbox');
  if (checkbox && !checkbox.disabled) {
    checkbox.checked = select;
    li.classList.toggle('selected', select);
    updateParentFolders(li);
  }
}

/**
 * Updates the checkbox states of all parent folders.
 * @param {HTMLElement} li - The starting li element.
 */
function updateParentFolders(li) {
  let currentLi = li.parentElement.closest('li[data-folder]');
  while (currentLi) {
    updateFolderCheckbox(currentLi);
    currentLi = currentLi.parentElement.closest('li[data-folder]');
  }
}

/**
 * Updates a folder's checkbox state based on its children.
 * @param {HTMLElement} li - The folder li element.
 */
function updateFolderCheckbox(li) {
  const checkbox = li.querySelector('.folder-checkbox');
  const fileLis = li.querySelectorAll(':scope > ul > li[data-file]');
  const subfolderLis = li.querySelectorAll(':scope > ul > li[data-folder]');

  let allFilesSelected = true;
  let someFilesSelected = false;
  fileLis.forEach(fileLi => {
    const fileCheckbox = fileLi.querySelector('.file-checkbox');
    if (fileCheckbox && !fileCheckbox.disabled) {
      if (fileCheckbox.checked) someFilesSelected = true;
      else allFilesSelected = false;
    }
  });

  let allSubfoldersChecked = true;
  let someSubfoldersChecked = false;
  subfolderLis.forEach(subLi => {
    const subCheckbox = subLi.querySelector('.folder-checkbox');
    if (subCheckbox.checked) someSubfoldersChecked = true;
    else if (subCheckbox.indeterminate) {
      someSubfoldersChecked = true;
      allSubfoldersChecked = false;
    } else allSubfoldersChecked = false;
  });

  if (allFilesSelected && allSubfoldersChecked && (fileLis.length > 0 || subfolderLis.length > 0)) {
    checkbox.checked = true;
    checkbox.indeterminate = false;
  } else if (someFilesSelected || someSubfoldersChecked) {
    checkbox.checked = false;
    checkbox.indeterminate = true;
  } else {
    checkbox.checked = false;
    checkbox.indeterminate = false;
  }
}

/**
 * Updates all folder checkboxes based on their children's states.
 */
function updateAllFolderCheckboxes() {
  const folderLis = document.getElementById('file-list').querySelectorAll('li[data-folder]');
  folderLis.forEach(updateFolderCheckbox);
}

/**
 * Toggles the collapse state of a folder.
 * @param {HTMLElement} li - The folder li element.
 */
export function toggleFolderCollapse(li) {
  const folderPath = li.getAttribute('data-folder');
  const isCollapsed = li.classList.contains('collapsed');

  if (isCollapsed) {
    li.classList.remove('collapsed');
    state.collapsedFolders.delete(folderPath);
  } else {
    li.classList.add('collapsed');
    state.collapsedFolders.add(folderPath);
  }
  import('./state.js').then(module => {
    module.saveStateToLocalStorage();
  });
}

/**
 * Handles file and folder selection and collapse/expand using event delegation.
 * Updates the selectedTree and XML preview without refreshing the entire file explorer.
 * @param {Event} event - The click event.
 */
export function handleFileSelection(event) {
  const target = event.target;
  const li = target.closest('li');
  if (!li) return;

  state.failedFiles.clear();

  if (target.classList.contains('folder-checkbox')) {
    toggleFolderSelection(li, target.checked);
  } else if (target.classList.contains('file-checkbox')) {
    toggleFileSelection(li, target.checked);
  } else if (target.classList.contains('folder-toggle') || target.classList.contains('folder-name')) {
    toggleFolderCollapse(li);
  } else if (target.classList.contains('file-name') && li.getAttribute('data-text-file') === 'true') {
    const checkbox = li.querySelector('.file-checkbox');
    toggleFileSelection(li, !checkbox.checked);
  }

  state.selectedTree = buildSelectedTree(document.getElementById('file-list'));
  updateXMLPreview(true);

  const selectedPaths = getSelectedPaths(state.selectedTree);
  setState('repoPrompt_fileSelection', JSON.stringify(selectedPaths));

  import('./state.js').then(module => module.saveStateToLocalStorage());
  document.dispatchEvent(new Event('fileSelectionChanged'));
}
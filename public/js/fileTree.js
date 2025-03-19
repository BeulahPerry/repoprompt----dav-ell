// public/js/fileTree.js
// Handles rendering of the file tree, file/folder selection, and toggling collapse/expand.

import { state } from './state.js';
import { updateXMLPreview } from './xmlPreview.js';
import { sortTreeEntries, isTextFile } from './utils.js'; // Added isTextFile import

/**
 * Recursively renders the file tree into an HTML unordered list.
 * @param {Object} tree - The file tree object.
 * @param {string} parentPath - The parent path.
 * @param {boolean} isRoot - Flag indicating whether to wrap in <ul> or not.
 * @returns {string} - The HTML string representing the file tree.
 */
export function renderFileTree(tree, parentPath = "", isRoot = false) {
  let html = isRoot ? "" : '<ul>';
  
  // Convert tree object to array of entries and sort them
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
      html += `<li data-file="${entry.path}" data-text-file="${isText}">${entry.name}</li>`;
    } else if (entry.type === "folder") {
      const folderPath = entry.path;
      // Start all folders collapsed by default
      state.collapsedFolders.add(folderPath);
      html += `<li data-folder="${folderPath}" class="collapsed">`;
      html += `<span class="folder-toggle">+</span>${entry.name}`;
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
export function applySavedFileSelections(savedPaths) {
  const fileList = document.getElementById('file-list');
  const allItems = fileList.querySelectorAll('li[data-file], li[data-folder]');
  
  allItems.forEach(item => {
    const path = item.getAttribute('data-file') || item.getAttribute('data-folder');
    if (savedPaths.includes(path)) {
      // Only select files if they are text files
      if (item.hasAttribute('data-file') && item.getAttribute('data-text-file') === 'true') {
        item.classList.add('selected');
        item.dataset.userClicked = true;
      } else if (item.hasAttribute('data-folder')) {
        item.classList.add('selected');
        item.dataset.userClicked = true;
      }
    }
  });
  
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
    const isSelected = li.classList.contains("selected");

    if (li.hasAttribute("data-file") && isSelected && li.getAttribute('data-text-file') === 'true') {
      const filePath = li.getAttribute("data-file");
      const fileName = filePath.split("/").pop();
      tree[fileName] = { type: "file", path: filePath };
    }

    if (li.hasAttribute("data-folder")) {
      let folderName;
      if (li.firstChild.nodeType === Node.TEXT_NODE) {
        folderName = li.firstChild.textContent.trim();
      } else {
        folderName = li.childNodes[1].textContent.trim();
      }
      const folderPath = li.getAttribute("data-folder");
      const nestedUl = li.querySelector(":scope > ul");
      const children = nestedUl ? buildSelectedTree(nestedUl, folderPath) : {};

      const allChildren = nestedUl ? nestedUl.querySelectorAll('li') : [];
      const selectedChildren = nestedUl ? nestedUl.querySelectorAll('li.selected') : [];
      const allSelected = allChildren.length > 0 && allChildren.length === selectedChildren.length;

      if (isSelected || Object.keys(children).length > 0) {
        tree[folderName] = {
          type: "folder",
          path: folderPath,
          children: children
        };
        if (allSelected && !isSelected) {
          li.classList.add("selected");
        } else if (!allSelected && isSelected && !li.dataset.userClicked) {
          li.classList.remove("selected");
        }
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
export function toggleFolderChildren(li, select) {
  const children = li.querySelectorAll(':scope > ul > li');
  children.forEach(child => {
    if (child.hasAttribute('data-file') && child.getAttribute('data-text-file') === 'true') {
      if (select) {
        child.classList.add('selected');
      } else {
        child.classList.remove('selected');
      }
    } else if (child.hasAttribute('data-folder')) {
      if (select) {
        child.classList.add('selected');
      } else {
        child.classList.remove('selected');
      }
      toggleFolderChildren(child, select);
    }
  });
}

/**
 * Toggles the collapse state of a folder.
 * @param {HTMLElement} li - The folder li element.
 */
export function toggleFolderCollapse(li) {
  const folderPath = li.getAttribute('data-folder');
  const isCollapsed = li.classList.contains('collapsed');
  const toggleSpan = li.querySelector('.folder-toggle');

  if (isCollapsed) {
    li.classList.remove('collapsed');
    toggleSpan.textContent = '-';
    state.collapsedFolders.delete(folderPath);
  } else {
    li.classList.add('collapsed');
    toggleSpan.textContent = '+';
    state.collapsedFolders.add(folderPath);
  }
  // Save state changes
  import('./state.js').then(module => {
    module.saveStateToLocalStorage();
  });
}

/**
 * Handles file and folder selection and collapse/expand using event delegation.
 * @param {Event} event - The click event.
 */
export function handleFileSelection(event) {
  const target = event.target;
  const li = target.closest('li');
  if (!li) return;

  // Clear failed files list since a new selection is being made
  state.failedFiles.clear();

  // If the user clicked on the folder toggle element, only toggle collapse.
  if (target.classList.contains('folder-toggle')) {
    toggleFolderCollapse(li);
    return;
  }

  // Handle selection and expansion for folders, or just selection for files.
  const isFolder = li.hasAttribute('data-folder');
  const isTextFileAttr = li.getAttribute('data-text-file');
  const isTextFile = isTextFileAttr === 'true';
  const wasSelected = li.classList.contains('selected');

  if (isFolder) {
    const isCollapsed = li.classList.contains('collapsed');
    if (isCollapsed) {
      // Expand and select all text file children
      li.classList.remove('collapsed');
      li.querySelector('.folder-toggle').textContent = '-';
      state.collapsedFolders.delete(li.getAttribute('data-folder'));
      li.classList.add('selected');
      li.dataset.userClicked = true;
      toggleFolderChildren(li, true);
    } else {
      // Collapse and deselect all children
      li.classList.add('collapsed');
      li.querySelector('.folder-toggle').textContent = '+';
      state.collapsedFolders.add(li.getAttribute('data-folder'));
      li.classList.remove('selected');
      delete li.dataset.userClicked; // Clear user-clicked flag
      toggleFolderChildren(li, false);
    }
  } else if (isTextFile) {
    // For text files only, toggle selection
    li.classList.toggle('selected');
    li.dataset.userClicked = true;
  } else {
    // Non-text files are not selectable; log and return
    console.log(`Non-text file clicked, selection prevented: ${li.textContent.trim()}`);
    return;
  }

  console.log(`Toggled selection for: ${li.textContent.trim()}`);
  state.selectedTree = buildSelectedTree(document.getElementById('file-list'));
  updateXMLPreview(true);

  // Save state changes
  import('./state.js').then(module => {
    module.saveStateToLocalStorage();
  });
}

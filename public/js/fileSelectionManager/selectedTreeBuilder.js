// Handles building the selected tree data structure based on UI state.

import { state } from '../state.js';
import { setState } from '../stateDB.js';
import { isTextFile } from '../utils.js';

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
 * Builds selected trees for all directories based on the current UI state.
 */
export function buildAllSelectedTrees() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;

  state.directories.forEach(dir => {
    const dirIdStr = String(dir.id);
    const topLi = fileList.querySelector(`:scope > li[data-dir-id="${dirIdStr}"]`);
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
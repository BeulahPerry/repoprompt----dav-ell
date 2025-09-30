// Handles rendering of the file tree and toggling collapse/expand.

import { state } from './state.js';
import { applySavedFileSelections } from './fileSelectionManager.js';
import { sortTreeEntries, isTextFile } from './utils.js';
import { highlightMatches } from './search.js';

/**
 * Recursively renders the file tree into an HTML unordered list with checkboxes for a specific directory.
 * @param {Object} tree - The file tree object for the directory.
 * @param {Object} selectedTree - The selected tree object for the directory.
 * @param {Set<string>} collapsedFolders - Set of collapsed folder paths for the directory.
 * @param {string} dirId - The unique identifier of the directory.
 * @param {string} parentPath - The parent path.
 * @param {boolean} isRoot - Flag indicating whether to wrap in <ul> or not.
 * @param {string} searchTerm - Optional search term for highlighting matches.
 * @returns {string} - The HTML string representing the file tree.
 */
export function renderFileTree(tree, selectedTree, collapsedFolders, dirId, parentPath = "", isRoot = false, searchTerm = "") {
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
      const displayName = searchTerm ? highlightMatches(entry.name, searchTerm) : entry.name;

      html += `<li data-file="${entry.path}" data-text-file="${isText}" data-dir-id="${dirId}" title="${entry.path}">`;
      html += `<div class="file-header">`;
      html += `<input type="checkbox" class="file-checkbox" ${isText ? '' : 'disabled'} ${isSelected ? 'checked' : ''}>`;
      html += `<span class="file-name">${displayName}</span>`;
      html += `<span class="dependency-indicator"></span>`;
      html += `</div></li>`;
    } else if (entry.type === "folder") {
      const folderPath = entry.path;
      // When searching, keep folders expanded to show matching files
      const isCollapsed = searchTerm ? false : collapsedFolders.has(folderPath);
      html += `<li data-folder="${folderPath}" data-dir-id="${dirId}" class="${isCollapsed ? 'collapsed' : ''}" title="${folderPath}">`;
      html += `<div class="folder-header">`;
      html += `<input type="checkbox" class="folder-checkbox">`;
      html += `<svg class="folder-toggle" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
      html += `<span class="folder-name">${entry.name}</span>`;
      html += `</div>`;
      const childSelectedTree = selectedTree[entry.name]?.children || {};
      html += renderFileTree(entry.children, childSelectedTree, collapsedFolders, dirId, folderPath, false, searchTerm);
      html += `</li>`;
    }
  }
  html += isRoot ? "" : '</ul>';
  return html;
}

/**
 * Renders the file explorer with all directories as top-level expandable/collapsible folders.
 * @param {Map|null} filteredTrees - Optional map of dirId to filtered tree (for search results).
 * @param {string} searchTerm - Optional search term for highlighting matches.
 */
export function renderFileExplorer(filteredTrees = null, searchTerm = "") {
  const fileListElement = document.getElementById('file-list');
  let html = '';
  state.directories.forEach(dir => {
    const dirName = dir.name || (dir.path ? dir.path.split('/').pop() : `dir-${dir.id}`);
    const dirIdentifier = dir.path || `dir-${dir.id}`;

    // Use filtered tree if searching, otherwise use full tree
    const treeToRender = filteredTrees ? filteredTrees.get(dir.id) : dir.tree;

    // If searching and this directory has no matches, skip it entirely
    if (filteredTrees && !treeToRender) {
      return;
    }

    // When searching, keep directories expanded; otherwise use saved state
    const isCollapsed = searchTerm ? false : dir.collapsedFolders.has(dirIdentifier);
    html += `<li data-folder="${dirIdentifier}" data-dir-id="${dir.id}" class="${isCollapsed ? 'collapsed' : ''}" title="${dirIdentifier}">`;
    html += `<div class="folder-header">`;
    html += `<input type="checkbox" class="folder-checkbox" ${dir.error ? 'disabled' : ''}>`;
    html += `<svg class="folder-toggle" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
    html += `<span class="folder-name">${dirName}</span>`;
    html += `</div>`;
    if (dir.error) {
      html += `<ul><li class="error">Error: ${dir.error}</li></ul>`;
    } else if (treeToRender) {
      html += renderFileTree(treeToRender, dir.selectedTree, dir.collapsedFolders, dir.id, dirIdentifier, false, searchTerm);
    }
    html += `</li>`;
  });

  // Show a message if searching but no results
  if (filteredTrees && html === '') {
    html = '<li class="no-results">No files match your search</li>';
  }

  fileListElement.innerHTML = html;
  applySavedFileSelections();
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
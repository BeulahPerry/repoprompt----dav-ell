// public/js/fileContent.js
// Manages file content fetching and caching.

import { state } from './state.js';
import { getLanguage } from './utils.js';
import { tryFetchWithFallback } from './connection.js'; // Added to support ngrok fallback

/**
 * Recursively retrieves all file nodes from a file tree.
 * @param {Object} tree - The file tree object.
 * @returns {Array<Object>} - Array of file nodes.
 */
export function getFileNodes(tree) {
  let files = [];
  for (let key in tree) {
    const node = tree[key];
    if (node.type === "file") files.push(node);
    else if (node.type === "folder" && node.children) {
      files = files.concat(getFileNodes(node.children));
    }
  }
  return files;
}

/**
 * Fetches file content from the server and caches the result.
 * @param {Object} fileNode - The file node object.
 * @returns {Promise<string>} - The file content wrapped in a markdown code block.
 */
export async function fetchFileContent(fileNode) {
  if (state.fileCache.has(fileNode.path)) {
    console.log(`Using cached content for: ${fileNode.path}`);
    return state.fileCache.get(fileNode.path);
  }

  const lang = getLanguage(fileNode.path);
  console.log(`Fetching file: ${fileNode.path}`);
  try {
    const url = `${state.baseEndpoint}/api/file?path=${encodeURIComponent(fileNode.path)}`;
    const response = await tryFetchWithFallback(url); // Use fallback-enabled fetch
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    if (data.success) {
      const content = `File: ${fileNode.path}\n\`\`\`${lang}\n${data.content}\n\`\`\`\n\n`;
      state.fileCache.set(fileNode.path, content);
      state.failedFiles.delete(fileNode.path); // Remove from failed list on success
      console.log(`Successfully fetched and cached: ${fileNode.path}`);
      return content;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error(`Fetch error for ${fileNode.path}: ${error.message}`);
    const errorContent = `File: ${fileNode.path}\n\`\`\`${lang}\n<!-- Error: ${error.message} -->\n\`\`\`\n\n`;
    state.fileCache.set(fileNode.path, errorContent);
    state.failedFiles.add(fileNode.path); // Add to failed list on error
    return errorContent;
  }
}

/**
 * Refreshes the content of all selected files by clearing their cache and re-fetching asynchronously.
 * @returns {Promise<void>}
 */
export async function refreshSelectedFiles() {
  if (state.uploadedFileTree) {
    console.log('Skipping refresh: Using uploaded file tree, no server polling needed.');
    return;
  }

  const selectedFiles = getFileNodes(state.selectedTree);
  if (selectedFiles.length === 0) {
    console.log('No selected files to refresh.');
    return;
  }

  console.log(`Refreshing content for ${selectedFiles.length} selected files asynchronously...`);
  // Delete cache for each file and refresh concurrently using Promise.all
  await Promise.all(selectedFiles.map(fileNode => {
    state.fileCache.delete(fileNode.path); // Clear cache to force re-fetch
    return fetchFileContent(fileNode); // Re-fetch content concurrently
  }));
  console.log('Selected file contents refreshed.');
}
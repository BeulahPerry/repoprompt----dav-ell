// File: /Users/davell/Documents/github/repoprompt/public/js/fileContent.js
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
 * This function is maintained for backward compatibility but should be avoided in favor of batch requests.
 * @param {Object} fileNode - The file node object.
 * @returns {Promise<string>} - The file content wrapped in a markdown code block.
 */
export async function fetchFileContent(fileNode) {
  if (state.fileCache.has(fileNode.path)) {
    console.log(`Using cached content for: ${fileNode.path}`);
    return state.fileCache.get(fileNode.path);
  }

  const lang = getLanguage(fileNode.path);
  console.log(`Workspaceing file: ${fileNode.path}`);
  try {
    const url = `${state.baseEndpoint}/api/file?path=${encodeURIComponent(fileNode.path)}`;
    const response = await tryFetchWithFallback(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

    if (data.success) {
      const content = `File: ${fileNode.path}\n\`\`\`${lang}\n${data.content}\n\`\`\`\n\n`;
      state.fileCache.set(fileNode.path, content);
      state.failedFiles.delete(fileNode.path);
      console.log(`Successfully fetched and cached: ${fileNode.path}`);
      return content;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error(`Workspace error for ${fileNode.path}: ${error.message}`);
    const errorContent = `File: ${fileNode.path}\n\`\`\`${lang}\n\n\`\`\`\n\n`;
    state.fileCache.set(fileNode.path, errorContent);
    state.failedFiles.add(fileNode.path);
    return errorContent;
  }
}

/**
 * Fetches contents for a batch of file nodes in a single network request.
 * @param {Array<Object>} fileNodes - Array of file nodes.
 * @param {boolean} force - If true, force re-fetching even if cached.
 * @returns {Promise<Array<string>>} - Array of file contents corresponding to the file nodes.
 */
export async function fetchBatchFileContents(fileNodes, force = false) {
  const pathsToFetch = [];
  for (const fileNode of fileNodes) {
    if (force || !state.fileCache.has(fileNode.path)) {
      pathsToFetch.push(fileNode.path);
    }
  }
  if (pathsToFetch.length > 0) {
    try {
      const url = `${state.baseEndpoint}/api/files`;
      const response = await tryFetchWithFallback(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paths: pathsToFetch })
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.success) {
        const filesData = data.files;
        for (const path of pathsToFetch) {
          const lang = getLanguage(path);
          const result = filesData[path];
          if (result && result.success) {
            const content = `File: ${path}\n\`\`\`${lang}\n${result.content}\n\`\`\`\n\n`;
            state.fileCache.set(path, content);
            state.failedFiles.delete(path);
          } else {
            const errorMsg = result ? result.error : "Unknown error";
            const errorContent = `File: ${path}\n\`\`\`${lang}\n\n\`\`\`\n\n`;
            state.fileCache.set(path, errorContent);
            state.failedFiles.add(path);
          }
        }
      } else {
        for (const path of pathsToFetch) {
          const lang = getLanguage(path);
          const errorContent = `File: ${path}\n\`\`\`${lang}\n\n\`\`\`\n\n`;
          state.fileCache.set(path, errorContent);
          state.failedFiles.add(path);
        }
      }
    } catch (error) {
      console.error(`Batch fetch error: ${error.message}`);
      for (const path of pathsToFetch) {
        const lang = getLanguage(path);
        const errorContent = `File: ${path}\n\`\`\`${lang}\n\n\`\`\`\n\n`;
        state.fileCache.set(path, errorContent);
        state.failedFiles.add(path);
      }
    }
  }
  return fileNodes.map(fileNode => {
    if (state.fileCache.has(fileNode.path)) {
      return state.fileCache.get(fileNode.path);
    } else {
      const lang = getLanguage(fileNode.path);
      return `File: ${fileNode.path}\n\`\`\`${lang}\n\n\`\`\`\n\n`;
    }
  });
}
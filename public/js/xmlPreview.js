// public/js/xmlPreview.js
// Generates XML output for the file mapping, file contents, and selected prompts,
// then updates the preview in the UI.

import { state } from './state.js';
import { formatTree, getSelectedPaths } from './fileTree.js';
import { getFileNodes, fetchBatchFileContents } from './fileContent.js';
import { getPromptsXML } from './prompts.js';
import { getLanguage } from './utils.js';
import { getUploadedFile } from './db.js';

/**
 * Updates the XML preview based on the current state.
 * @param {boolean} forceFullUpdate - Whether to force a full update.
 */
export async function updateXMLPreview(forceFullUpdate = false) {
  console.log('Updating XML preview...');

  // File map section: include selected files/folders from all directories
  let fileMapStr = '';
  state.directories.forEach(dir => {
    if (Object.keys(dir.selectedTree).length > 0) {
      fileMapStr += `<file_map directory="${dir.path || dir.name}">\n${dir.path || dir.name}\n`;
      const treeLines = formatTree(dir.selectedTree);
      treeLines.forEach(line => fileMapStr += line + "\n");
      fileMapStr += `</file_map>\n`;
    }
  });
  if (!fileMapStr) {
    fileMapStr = `<file_map>\n<!-- No directories or files selected -->\n</file_map>`;
  }

  // File contents section: process file nodes from all selected trees
  let fileContentsStr = `<file_contents>\n`;
  let allFileNodes = [];
  state.directories.forEach(dir => {
    if (Object.keys(dir.selectedTree).length > 0) {
      const nodes = getFileNodes(dir.selectedTree).map(node => ({ dirId: dir.id, path: node.path, type: dir.type }));
      allFileNodes = allFileNodes.concat(nodes);
    }
  });

  if (allFileNodes.length > 0) {
    console.log(`Processing contents for ${allFileNodes.length} files`);
    const uploadedFiles = allFileNodes.filter(node => node.type === 'uploaded');
    const serverFiles = allFileNodes.filter(node => node.type === 'path');

    // Fetch contents for uploaded files from IndexedDB
    const uploadedContents = await Promise.all(uploadedFiles.map(async node => {
      const lang = getLanguage(node.path);
      const content = await getUploadedFile(node.dirId, node.path);
      return `File: ${node.path}\n\`\`\`${lang}\n${content || "<!-- Content not found -->"}\n\`\`\`\n\n`;
    }));

    // Fetch contents for server files in a batch request
    const serverContents = serverFiles.length > 0
      ? await fetchBatchFileContents(serverFiles.map(node => ({ path: node.path })), false)
      : [];

    fileContentsStr += uploadedContents.concat(serverContents).join('');
  } else {
    console.log('No files selected for content fetching');
    fileContentsStr += `<!-- No file contents available -->\n`;
  }
  fileContentsStr += `</file_contents>`;

  // Prompts section
  let promptsStr = getPromptsXML();
  if (promptsStr === '') {
    promptsStr = `<!-- No prompts selected -->\n`;
  }

  // User instructions section
  const userInstructionsStr = `<user_instructions>\n${state.userInstructions}\n</user_instructions>`;

  const finalXML = `${fileMapStr}\n\n${fileContentsStr}\n\n${promptsStr}\n${userInstructionsStr}`;
  document.getElementById('xml-output').textContent = finalXML;
  console.log('XML preview updated');

  // Update failed files list
  const failedFilesDiv = document.getElementById('failed-files');
  failedFilesDiv.innerHTML = '';
  if (state.failedFiles.size > 0) {
    const header = document.createElement('h3');
    header.textContent = 'Files That Failed to Fetch:';
    failedFilesDiv.appendChild(header);
    
    const ul = document.createElement('ul');
    state.failedFiles.forEach(filePath => {
      const li = document.createElement('li');
      li.textContent = filePath;
      ul.appendChild(li);
    });
    failedFilesDiv.appendChild(ul);
  }

  // Save state after updating the preview.
  import('./state.js').then(module => {
    module.saveStateToLocalStorage();
  });
}
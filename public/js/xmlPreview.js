// public/js/xmlPreview.js
// Generates XML output for the file mapping, file contents, and selected prompts,
// then updates the preview in the UI.

import { state } from './state.js';
import { formatTree, getSelectedPaths } from './fileTree.js';
import { getFileNodes, fetchFileContent } from './fileContent.js';
import { getPromptsXML } from './prompts.js';
import { getLanguage } from './utils.js';
import { getUploadedFile } from './db.js'; // Import IndexedDB function

/**
 * Updates the XML preview based on the current state.
 * @param {boolean} forceFullUpdate - Whether to force a full update.
 */
export async function updateXMLPreview(forceFullUpdate = false) {
  console.log('Updating XML preview...');

  // File map section: only include selected files/folders
  let fileMapStr = `<file_map>\n${state.rootDirectory || 'No directory specified'}\n`;
  if (Object.keys(state.selectedTree).length > 0) {
    const treeLines = formatTree(state.selectedTree);
    treeLines.forEach(line => fileMapStr += line + "\n");
  } else {
    fileMapStr += "<!-- No files selected -->\n";
  }
  fileMapStr += `</file_map>`;

  // File contents section: process file nodes from the selected tree only
  let fileContentsStr = `<file_contents>\n`;
  let fileNodes = [];
  if (Object.keys(state.selectedTree).length > 0) {
    if (state.uploadedFileTree) {
      // For uploaded files, get nodes from the selected tree and use the uploaded file content from IndexedDB
      fileNodes = getFileNodes(state.selectedTree);
      if (fileNodes.length > 0) {
        console.log(`Processing contents for ${fileNodes.length} uploaded files`);
        const fileContentsArray = await Promise.all(fileNodes.map(async fileNode => {
          const lang = getLanguage(fileNode.path);
          const content = await getUploadedFile(fileNode.path);
          return `File: ${fileNode.path}\n\`\`\`${lang}\n${content || "<!-- Content not found -->"}\n\`\`\`\n\n`;
        }));
        fileContentsStr += fileContentsArray.join('');
      } else {
        console.log('No uploaded files selected for content fetching');
        fileContentsStr += `<!-- No file contents available -->\n`;
      }
    } else {
      // For non-uploaded files, fetch content from the server for the selected tree
      fileNodes = getFileNodes(state.selectedTree);
      if (fileNodes.length > 0) {
        console.log(`Processing contents for ${fileNodes.length} files`);
        const fileContentsArray = await Promise.all(fileNodes.map(fileNode => fetchFileContent(fileNode)));
        fileContentsStr += fileContentsArray.join('');
      } else {
        console.log('No files selected for content fetching');
        fileContentsStr += `<!-- No file contents available -->\n`;
      }
    }
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
  failedFilesDiv.innerHTML = ''; // Clear previous content
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
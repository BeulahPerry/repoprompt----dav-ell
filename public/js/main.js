// File: /Users/davell/Documents/github/repoprompt/public/js/main.js
// Main entry point for the application. Initializes state, attaches event listeners, and wires up all modules.

import { state, loadStateFromLocalStorage, saveStateToLocalStorage } from './state.js';
import { debounce } from './utils.js';
import { renderFileExplorer } from './fileTreeRenderer.js';
import { handleFileSelection } from './fileSelectionManager.js';
import { updateXMLPreview } from './xmlPreview.js';
import { generateFileExplorer } from './explorer.js';
import { checkConnection } from './connection.js';
import { loadPromptsFromStorage, renderPromptCheckboxes } from './prompts.js';
import { initPromptModal } from './promptModal.js';
import { initWhitelistModal } from './whitelist.js';
import { handleZipUpload, handleFolderUpload } from './uploader.js';

/**
 * Renders the list of directories in the UI with remove buttons.
 */
function renderDirectoriesList() {
  const list = document.getElementById('directories-list');
  list.innerHTML = '';
  state.directories.forEach(dir => {
    const div = document.createElement('div');
    div.className = 'directory-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = dir.name || dir.path;
    div.appendChild(nameSpan);

    const buttonContainer = document.createElement('div'); // Container for buttons
    buttonContainer.style.display = 'flex';
    buttonContainer.style.alignItems = 'center';

    // Add Update button only for 'path' type directories
    if (dir.type === 'path') {
      const updateBtn = document.createElement('button');
      updateBtn.textContent = 'Update';
      updateBtn.addEventListener('click', async () => {
        console.log(`Manual update triggered for directory ID: ${dir.id}`);
        await generateFileExplorer(dir.id);
        await updateXMLPreview(true); // Refresh preview after updating tree
      });
      buttonContainer.appendChild(updateBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.directories = state.directories.filter(d => d.id !== dir.id);
      if (state.directories.length === 0) {
        state.currentDirectoryId = null;
        document.getElementById('file-list').innerHTML = '<ul><li>No directories added</li></ul>';
      } else if (state.currentDirectoryId === dir.id) {
        state.currentDirectoryId = state.directories[0].id;
      }
      renderDirectoriesList();
      renderFileExplorer();
      saveStateToLocalStorage();
      updateXMLPreview(true);
    });
    buttonContainer.appendChild(removeBtn); // Add remove button to container

    div.appendChild(buttonContainer); // Add button container to directory item
    list.appendChild(div);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved state from IndexedDB/localStorage.
  await loadStateFromLocalStorage();

  // Initialize UI elements with saved state.
  const endpointInput = document.getElementById('endpoint-url');
  if (state.baseEndpoint) {
    endpointInput.value = state.baseEndpoint;
  }
  const userInstructionsInput = document.getElementById('user-instructions');
  if (state.userInstructions) {
    userInstructionsInput.value = state.userInstructions;
  }

  // Load available prompts from localStorage and render prompt checkboxes.
  loadPromptsFromStorage();
  renderPromptCheckboxes();

  // Initialize prompt and whitelist modals.
  initPromptModal();
  initWhitelistModal();

  // Render initial directories list and file explorer
  renderDirectoriesList();
  if (state.directories.length > 0) {
    renderFileExplorer();
  } else {
    document.getElementById('file-list').innerHTML = '<ul><li>No directories added</li></ul>';
  }

  // Debounce updating the XML preview when user instructions change.
  const debouncedUpdate = debounce(() => {
    state.userInstructions = document.getElementById('user-instructions').value.trim() || "No instructions provided.";
    updateXMLPreview();
  }, 500);

  document.getElementById('user-instructions').addEventListener('input', debouncedUpdate);
  document.getElementById('file-list').addEventListener('click', handleFileSelection);
  
  // Copy XML event handler with Clipboard API fallback.
  document.getElementById('copy-btn').addEventListener('click', async () => {
    await updateXMLPreview(true);
    const xmlText = document.getElementById('xml-output').textContent;
    const feedbackElement = document.getElementById('copy-feedback');
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(xmlText)
        .then(() => {
          feedbackElement.classList.add('show');
          console.log('XML copied to clipboard');
          setTimeout(() => feedbackElement.classList.remove('show'), 1000);
        })
        .catch(err => console.error('Failed to copy XML: ', err));
    } else {
      const tempTextArea = document.createElement('textarea');
      tempTextArea.value = xmlText;
      tempTextArea.style.position = 'fixed';
      tempTextArea.style.top = '0';
      tempTextArea.style.left = '0';
      tempTextArea.style.opacity = '0';
      document.body.appendChild(tempTextArea);
      tempTextArea.focus();
      tempTextArea.select();
      
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          feedbackElement.classList.add('show');
          console.log('XML copied to clipboard using fallback');
          setTimeout(() => feedbackElement.classList.remove('show'), 1000);
        } else {
          console.error('Fallback: Copy command was unsuccessful');
        }
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
      }
      document.body.removeChild(tempTextArea);
    }
  });

  // Add directory path
  document.getElementById('add-path-btn').addEventListener('click', async () => {
    const path = prompt('Enter absolute directory path (e.g., /home/user/project):');
    if (path) {
      const dirId = Date.now();
      const newDir = { id: dirId, type: 'path', path, tree: {}, selectedTree: {}, collapsedFolders: new Set() };
      state.directories.push(newDir);
      state.currentDirectoryId = dirId;
      renderDirectoriesList();
      await generateFileExplorer(dirId);
      // Removed subscribeToFileUpdates call
    }
  });

  // Check connection
  document.getElementById('connect-endpoint').addEventListener('click', async () => {
    await checkConnection();
    document.getElementById('directory-section').style.display = state.baseEndpoint ? 'block' : 'none';
  });

  // Setup upload buttons and inputs
  const uploadBtn = document.getElementById('upload-btn');
  const zipInput = document.getElementById('zip-upload');
  uploadBtn.addEventListener('click', () => zipInput.click());
  zipInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
      const dirId = Date.now();
      const newDir = { id: dirId, type: 'uploaded', name: file.name, tree: {}, selectedTree: {}, collapsedFolders: new Set() };
      state.directories.push(newDir);
      state.currentDirectoryId = dirId;
      await handleZipUpload(file);
      renderDirectoriesList();
      renderFileExplorer();
      // Removed subscribeToFileUpdates call
    }
  });

  const uploadFolderBtn = document.getElementById('upload-folder-btn');
  const folderInput = document.getElementById('folder-upload');
  uploadFolderBtn.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const dirId = Date.now();
      const firstPath = files[0].webkitRelativePath;
      const baseFolder = firstPath.split('/')[0];
      const newDir = { id: dirId, type: 'uploaded', name: baseFolder, tree: {}, selectedTree: {}, collapsedFolders: new Set() };
      state.directories.push(newDir);
      state.currentDirectoryId = dirId;
      await handleFolderUpload(files);
      renderDirectoriesList();
      renderFileExplorer();
    }
  });

  // Update directory (kept for legacy button, might be redundant now)
  document.getElementById('update-directory').addEventListener('click', async () => {
    if (!state.currentDirectoryId) return;
    const dir = state.directories.find(d => d.id === state.currentDirectoryId);
    if (dir && dir.type === 'path') { // Only allow update for path type
        const newPath = document.getElementById('directory-path').value.trim();
        if (newPath && newPath !== dir.path) {
            dir.path = newPath;
            await generateFileExplorer(state.currentDirectoryId);
            renderDirectoriesList(); // Re-render list to show new path
            saveStateToLocalStorage();
        } else if (newPath === dir.path) {
             await generateFileExplorer(state.currentDirectoryId); // Just refresh if path is same
        }
    } else {
        console.log("Update button is for path directories only or current directory not found.");
    }
  });
  
  // Resizable file explorer
  const fileExplorer = document.querySelector('.file-explorer');
  const header = document.querySelector('header');
  const container = document.querySelector('.container');
  const resizeHandle = document.querySelector('.resize-handle');

  let isResizing = false;
  let savedWidth = localStorage.getItem('fileExplorerWidth');
  if (savedWidth) {
    savedWidth = parseInt(savedWidth, 10);
    const minWidth = 100;
    const maxWidth = window.innerWidth - 100;
    if (savedWidth < minWidth) savedWidth = minWidth;
    if (savedWidth > maxWidth) savedWidth = maxWidth;
    fileExplorer.style.width = `${savedWidth}px`;
    header.style.left = `${savedWidth}px`;
    header.style.width = `calc(100% - ${savedWidth}px)`;
    container.style.marginLeft = `${savedWidth}px`;
    container.style.width = `calc(100% - ${savedWidth}px)`;
  }

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (isResizing) {
      let newWidth = e.clientX;
      const minWidth = 100;
      const maxWidth = window.innerWidth - 100;
      if (newWidth < minWidth) newWidth = minWidth;
      if (newWidth > maxWidth) newWidth = maxWidth;
      fileExplorer.style.width = `${newWidth}px`;
      header.style.left = `${newWidth}px`;
      header.style.width = `calc(100% - ${newWidth}px)`;
      container.style.marginLeft = `${newWidth}px`;
      container.style.width = `calc(100% - ${newWidth}px)`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const currentWidth = parseInt(fileExplorer.style.width, 10);
      localStorage.setItem('fileExplorerWidth', currentWidth);
    }
  });
});
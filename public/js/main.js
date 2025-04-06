// public/js/main.js
// Main entry point for the application. Initializes state, attaches event listeners, and wires up all modules.

import { state, loadStateFromLocalStorage, saveStateToLocalStorage } from './state.js';
import { debounce } from './utils.js';
import { handleFileSelection } from './fileTree.js';
import { updateXMLPreview } from './xmlPreview.js';
import { generateFileExplorer } from './explorer.js';
import { checkConnection } from './connection.js';
import { loadPromptsFromStorage, renderPromptCheckboxes } from './prompts.js';
import { initPromptModal } from './promptModal.js';
import { initWhitelistModal } from './whitelist.js';
import { handleZipUpload, handleFolderUpload } from './uploader.js';
import { refreshSelectedFiles } from './fileContent.js'; // Still imported for file updates via SSE

/**
 * Helper function to compute minimal directories from an array of file paths.
 * This reduces the size of the query string when subscribing for file updates.
 * @param {Array<string>} paths - Array of full file paths.
 * @returns {Array<string>} - Minimal set of directories.
 */
function getMinimalDirsFromFiles(paths) {
  // Map each file to its directory
  const dirs = paths.map(file => {
    const parts = file.split('/');
    parts.pop(); // Remove filename
    return parts.join('/');
  });
  // Remove duplicates
  const uniqueDirs = Array.from(new Set(dirs));
  // Sort by length (shortest first)
  uniqueDirs.sort((a, b) => a.length - b.length);
  const minimal = [];
  for (const dir of uniqueDirs) {
    if (!minimal.some(existing => dir.startsWith(existing))) {
      minimal.push(dir);
    }
  }
  return minimal;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved state from IndexedDB/localStorage.
  await loadStateFromLocalStorage();

  // Initialize UI elements with saved state.
  const directoryInput = document.getElementById('directory-path');
  if (state.rootDirectory) {
    directoryInput.value = state.rootDirectory;
  }
  const endpointInput = document.getElementById('endpoint-url');
  if (state.baseEndpoint) {
    endpointInput.value = state.baseEndpoint;
  }
  // Set the user instructions textarea with saved instructions.
  const userInstructionsInput = document.getElementById('user-instructions');
  if (state.userInstructions) {
    userInstructionsInput.value = state.userInstructions;
  }

  // Load available prompts from localStorage and render prompt checkboxes.
  loadPromptsFromStorage();
  renderPromptCheckboxes();

  // Initialize prompt modal functionality.
  initPromptModal();
  // Initialize whitelist modal functionality.
  initWhitelistModal();

  // Set initial visibility of directory-section
  if (state.baseEndpoint && !state.uploadedFileTree) {
    document.getElementById('directory-section').style.display = 'block';
  } else {
    document.getElementById('directory-section').style.display = 'none';
  }

  // If there is an uploaded file tree, use it to generate the file explorer;
  // otherwise, load from the server.
  if (state.uploadedFileTree) {
    import('./fileTree.js').then(module => {
      document.getElementById('file-list').innerHTML = module.renderFileTree(state.uploadedFileTree, "", true);
    });
    updateXMLPreview();
  } else {
    generateFileExplorer().then(() => {
      // After generating the explorer, subscribe for file updates.
      subscribeToFileUpdates();
    });
  }

  // Debounce updating the XML preview when user instructions change.
  const debouncedUpdate = debounce(() => {
    state.userInstructions = document.getElementById('user-instructions').value.trim() || "No instructions provided.";
    updateXMLPreview();
  }, 500);

  document.getElementById('user-instructions').addEventListener('input', debouncedUpdate);
  document.getElementById('file-list').addEventListener('click', handleFileSelection);
  
  // Updated copy XML event handler with Clipboard API fallback.
  document.getElementById('copy-btn').addEventListener('click', async () => {
    await updateXMLPreview(true); // Force full update of the XML preview without re-fetching file contents.
    const xmlText = document.getElementById('xml-output').textContent;
    const feedbackElement = document.getElementById('copy-feedback');
    
    // Check if Clipboard API is available.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(xmlText)
        .then(() => {
          feedbackElement.classList.add('show');
          console.log('XML copied to clipboard');
          setTimeout(() => {
            feedbackElement.classList.remove('show');
          }, 1000);
        })
        .catch(err => console.error('Failed to copy XML: ', err));
    } else {
      // Fallback for older browsers: create a temporary textarea.
      const tempTextArea = document.createElement('textarea');
      tempTextArea.value = xmlText;
      // Avoid scrolling to bottom.
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
          setTimeout(() => {
            feedbackElement.classList.remove('show');
          }, 1000);
        } else {
          console.error('Fallback: Copy command was unsuccessful');
        }
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
      }
      document.body.removeChild(tempTextArea);
    }
  });

  // Update directory when the user clicks the update button.
  document.getElementById('update-directory').addEventListener('click', async function() {
    state.rootDirectory = document.getElementById('directory-path').value.trim();
    if (!state.rootDirectory) {
      alert('Please enter a valid directory path');
      return;
    }
    console.log(`Updating directory to: ${state.rootDirectory}`);
    // Clear any previously uploaded file data if a directory is manually specified.
    state.uploadedFileTree = null;
    await generateFileExplorer();
    await saveStateToLocalStorage();
    // Re-subscribe for file updates after updating the directory
    subscribeToFileUpdates();
  });

  // Check connection when the user clicks the connect button.
  document.getElementById('connect-endpoint').addEventListener('click', async () => {
    await checkConnection();
    if (state.baseEndpoint && !state.uploadedFileTree) {
      document.getElementById('directory-section').style.display = 'block';
    } else {
      document.getElementById('directory-section').style.display = 'none';
    }
  });

  // Setup the upload button and file input event listeners.
  const uploadBtn = document.getElementById('upload-btn');
  const zipInput = document.getElementById('zip-upload');
  uploadBtn.addEventListener('click', () => {
    zipInput.click();
  });
  zipInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
      await handleZipUpload(file);
      // Re-subscribe after uploading new files
      subscribeToFileUpdates();
    }
  });

  // Setup the folder upload button and file input event listeners.
  const uploadFolderBtn = document.getElementById('upload-folder-btn');
  const folderInput = document.getElementById('folder-upload');
  uploadFolderBtn.addEventListener('click', () => {
    folderInput.click();
  });
  folderInput.addEventListener('change', async (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      await handleFolderUpload(files);
      // Re-subscribe after uploading new files
      subscribeToFileUpdates();
    }
  });
  
  // Listen for file selection changes and re-subscribe for updates.
  document.addEventListener('fileSelectionChanged', () => {
    subscribeToFileUpdates();
  });

  // Resizable file explorer
  const fileExplorer = document.querySelector('.file-explorer');
  const header = document.querySelector('header');
  const container = document.querySelector('.container');
  const resizeHandle = document.querySelector('.resize-handle');

  let isResizing = false;

  // Load saved width from localStorage
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

/**
 * Subscribes to the server’s file change notifications using Server-Sent Events (SSE).
 * If the number of selected files exceeds a predefined limit, an error is shown.
 */
function subscribeToFileUpdates() {
  // If an existing EventSource exists, close it before re-subscribing.
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  
  // Initialize retry count if not present
  if (!state.hasOwnProperty('eventSourceRetries')) {
    state.eventSourceRetries = 0;
  }

  // Get selected file paths from the current selected tree.
  import('./fileTree.js').then(module => {
    const selectedPaths = module.getSelectedPaths(state.selectedTree);
    if (selectedPaths.length === 0) {
      console.log("No files selected for monitoring.");
      return;
    }
    // Compute minimal directories from the selected file paths to avoid huge query strings.
    const minimalDirs = getMinimalDirsFromFiles(selectedPaths);
    const filesParam = encodeURIComponent(JSON.stringify(minimalDirs));
    const directoryParam = encodeURIComponent(state.rootDirectory);
    const eventSourceUrl = `${state.baseEndpoint}/api/subscribe?directory=${directoryParam}&files=${filesParam}`;
    console.log(`Subscribing to file updates at: ${eventSourceUrl}`);
    const eventSource = new EventSource(eventSourceUrl);

    eventSource.onmessage = (event) => {
      // Generic messages (if any) can be handled here.
      console.log(`SSE message received: ${event.data}`);
    };

    eventSource.addEventListener('fileUpdate', async (event) => {
      console.log(`File update detected: ${event.data}`);
      // Refresh file content for updated files and update XML preview.
      await refreshSelectedFiles();
      await updateXMLPreview(true);
      // Reset retries on successful update
      state.eventSourceRetries = 0;
    });

    eventSource.addEventListener('error', (event) => {
      const errorMessage = event.data ? event.data : 'Unknown error occurred';
      console.error(`Error from file monitoring: ${errorMessage}`, {
        readyState: eventSource.readyState,
        eventDetails: event
      });
      eventSource.close();
      state.eventSource = null;

      // Attempt to reconnect if max retries not reached
      const maxRetries = 5;
      if (state.eventSourceRetries < maxRetries) {
        state.eventSourceRetries += 1;
        console.log(`Reconnection attempt ${state.eventSourceRetries} of ${maxRetries} in 2 seconds...`);
        setTimeout(() => {
          subscribeToFileUpdates();
        }, 2000);
      } else {
        console.error('Maximum reconnection attempts reached. Please check server status or directory permissions.');
      }
    });
    
    // Save the EventSource so that we can close it later if needed.
    state.eventSource = eventSource;
    // Reset retries on successful connection
    state.eventSourceRetries = 0;
  });
}
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

document.addEventListener('DOMContentLoaded', () => {
  // Load saved state from localStorage.
  loadStateFromLocalStorage();

  // Initialize UI elements with saved state.
  const directoryInput = document.getElementById('directory-path');
  if (state.rootDirectory) {
    directoryInput.value = state.rootDirectory;
  }
  const endpointInput = document.getElementById('endpoint-url');
  if (state.baseEndpoint) {
    endpointInput.value = state.baseEndpoint;
  }

  // Load available prompts from localStorage and render prompt checkboxes.
  loadPromptsFromStorage();
  renderPromptCheckboxes();

  // Initialize prompt modal functionality.
  initPromptModal();

  // Generate the file explorer based on the current directory.
  generateFileExplorer();

  // Debounce updating the XML preview when user instructions change.
  const debouncedUpdate = debounce(() => {
    state.userInstructions = document.getElementById('user-instructions').value.trim() || "No instructions provided.";
    updateXMLPreview();
  }, 500);

  document.getElementById('user-instructions').addEventListener('input', debouncedUpdate);
  document.getElementById('file-list').addEventListener('click', handleFileSelection);
  
  // Copy XML to clipboard with feedback.
  document.getElementById('copy-btn').addEventListener('click', () => {
    const xmlText = document.getElementById('xml-output').textContent;
    const feedbackElement = document.getElementById('copy-feedback');
    
    navigator.clipboard.writeText(xmlText)
      .then(() => {
        feedbackElement.classList.add('show');
        console.log('XML copied to clipboard');
        setTimeout(() => {
          feedbackElement.classList.remove('show');
        }, 1000);
      })
      .catch(err => console.error('Failed to copy XML: ', err));
  });

  // Update directory when the user clicks the update button.
  document.getElementById('update-directory').addEventListener('click', async function() {
    state.rootDirectory = document.getElementById('directory-path').value.trim();
    if (!state.rootDirectory) {
      alert('Please enter a valid directory path');
      return;
    }
    console.log(`Updating directory to: ${state.rootDirectory}`);
    await generateFileExplorer();
    saveStateToLocalStorage();
  });

  // Check connection when the user clicks the connect button.
  document.getElementById('connect-endpoint').addEventListener('click', checkConnection);
});
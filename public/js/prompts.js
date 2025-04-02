// public/js/prompts.js
// Manages prompt persistence in localStorage, rendering prompt checkboxes, and generating the XML snippet for prompts.

// Import the state directly to access selected prompts synchronously.
import { state } from './state.js';

// Storage key for prompts in localStorage
const PROMPTS_STORAGE_KEY = 'repoPrompt_prompts';

/**
 * Stores available prompts.
 * The object format is: { promptName: promptText, ... }
 */
export let availablePrompts = {};

/**
 * Loads available prompts from localStorage.
 * If none are found, starts with an empty object.
 */
export function loadPromptsFromStorage() {
  const storedPrompts = localStorage.getItem(PROMPTS_STORAGE_KEY);
  if (storedPrompts) {
    try {
      availablePrompts = JSON.parse(storedPrompts);
    } catch (error) {
      console.error('Failed to parse stored prompts:', error.message);
      availablePrompts = {};
    }
  } else {
    availablePrompts = {};
  }
}

/**
 * Saves available prompts to localStorage.
 */
export function savePromptsToStorage() {
  localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(availablePrompts));
}

/**
 * Renders prompt checkboxes dynamically.
 * Each checkbox reflects whether the prompt is selected (tracked in state.selectedPrompts).
 */
export function renderPromptCheckboxes() {
  const container = document.getElementById('prompt-checkboxes');
  container.innerHTML = '';
  Object.entries(availablePrompts).forEach(([name, text]) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `prompt-${name}`;
    // Set checkbox checked based on whether the prompt is already selected in the state
    checkbox.checked = state.selectedPrompts.has(name);
    label.appendChild(checkbox);
    label.append(` ${name.replace(/-/g, ' ')}`);
    container.appendChild(label);

    checkbox.addEventListener('change', () => {
      // Dynamically update the selected prompts in the state
      import('./state.js').then(module => {
        if (checkbox.checked) {
          module.state.selectedPrompts.add(name);
        } else {
          module.state.selectedPrompts.delete(name);
        }
        import('./xmlPreview.js').then(xmlModule => {
          xmlModule.updateXMLPreview();
        });
        module.saveStateToLocalStorage();
      });
    });
  });
}

/**
 * Generates the XML string for selected prompts.
 * @returns {string} - XML snippet for prompts.
 */
export function getPromptsXML() {
  let promptsStr = '';
  let promptIndex = 1;
  state.selectedPrompts.forEach(promptName => {
    const promptText = availablePrompts[promptName] || 'Prompt text not found';
    promptsStr += `<meta prompt ${promptIndex}="${promptName}">\n${promptText}\n</meta prompt ${promptIndex}>\n`;
    promptIndex++;
  });
  return promptsStr;
}

/**
 * Adds a new prompt to availablePrompts and persists it.
 * @param {string} name - The prompt name (unique identifier).
 * @param {string} text - The prompt text.
 */
export function addPrompt(name, text) {
  if (!name || !text) {
    console.error('Both prompt name and text are required.');
    return;
  }
  availablePrompts[name] = text;
  savePromptsToStorage();
  renderPromptCheckboxes();
  renderPromptsManagementList();
}

/**
 * Edits an existing prompt.
 * @param {string} oldName - The original prompt name.
 * @param {string} newName - The new prompt name.
 * @param {string} newText - The new prompt text.
 */
export function editPrompt(oldName, newName, newText) {
  if (!newName || !newText) {
    console.error('Both prompt name and text are required for editing.');
    return;
  }
  if (oldName !== newName && availablePrompts[newName]) {
    alert('A prompt with the new name already exists. Please choose a different name.');
    return;
  }
  // Remove old prompt if name has changed
  if (oldName !== newName) {
    delete availablePrompts[oldName];
  }
  availablePrompts[newName] = newText;
  savePromptsToStorage();
  renderPromptCheckboxes();
  renderPromptsManagementList();
}

/**
 * Removes a prompt from availablePrompts.
 * @param {string} name - The prompt name to remove.
 */
export function removePrompt(name) {
  if (availablePrompts[name]) {
    delete availablePrompts[name];
    savePromptsToStorage();
    renderPromptCheckboxes();
    renderPromptsManagementList();
  } else {
    console.error(`Prompt "${name}" does not exist.`);
  }
}

/**
 * Renders the management list of prompts with edit and delete buttons.
 */
export function renderPromptsManagementList() {
  const container = document.getElementById('prompt-management-list');
  container.innerHTML = '';
  
  Object.entries(availablePrompts).forEach(([name, text]) => {
    const promptItem = document.createElement('div');
    promptItem.classList.add('prompt-item');
    
    const promptInfo = document.createElement('div');
    promptInfo.classList.add('prompt-info');
    promptInfo.style.padding = "10px";
    promptInfo.innerHTML = `<strong>${name}</strong>: ${text}`;
    
    const editButton = document.createElement('button');
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => {
      // Populate the modal inputs with the selected prompt's data
      document.getElementById('new-prompt-name').value = name;
      document.getElementById('new-prompt-text').value = text;
      // Set data attribute to indicate edit mode with the original name
      document.getElementById('save-prompt').setAttribute('data-editing', name);
      document.getElementById('save-prompt').textContent = 'Update Prompt';
      // Show the cancel edit button
      document.getElementById('cancel-edit').style.display = 'inline-block';
    });
    
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete the prompt "${name}"?`)) {
        removePrompt(name);
      }
    });
    
    promptItem.appendChild(promptInfo);
    promptItem.appendChild(editButton);
    promptItem.appendChild(deleteButton);
    
    container.appendChild(promptItem);
  });
}
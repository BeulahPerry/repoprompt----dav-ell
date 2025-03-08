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
    checkbox.checked = false;
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
}
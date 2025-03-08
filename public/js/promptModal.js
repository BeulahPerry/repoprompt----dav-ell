// public/js/promptModal.js
// Manages the modal interface for adding new prompts.

import { addPrompt } from './prompts.js';

/**
 * Initializes the prompt modal: sets up event listeners for opening, closing,
 * and saving a new prompt.
 */
export function initPromptModal() {
  const modal = document.getElementById('prompt-modal');
  const openBtn = document.getElementById('manage-prompts-btn');
  const closeBtn = modal.querySelector('.close');
  const saveBtn = document.getElementById('save-prompt');
  const promptNameInput = document.getElementById('new-prompt-name');
  const promptTextInput = document.getElementById('new-prompt-text');

  // Show modal when clicking "Manage Prompts" button
  openBtn.addEventListener('click', () => {
    modal.style.display = 'block';
  });

  // Hide modal when clicking on the close (X) button
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    clearModalInputs();
  });

  // Hide modal when clicking outside the modal content
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
      clearModalInputs();
    }
  });

  // Save new prompt when clicking the "Save Prompt" button
  saveBtn.addEventListener('click', () => {
    const name = promptNameInput.value.trim();
    const text = promptTextInput.value.trim();
    if (!name || !text) {
      alert('Please fill in both the prompt name and text.');
      return;
    }
    addPrompt(name, text);
    modal.style.display = 'none';
    clearModalInputs();
  });

  /**
   * Clears the modal input fields.
   */
  function clearModalInputs() {
    promptNameInput.value = '';
    promptTextInput.value = '';
  }
}
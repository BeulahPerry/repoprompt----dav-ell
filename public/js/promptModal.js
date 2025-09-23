// public/js/promptModal.js
// Manages the modal interface for adding new prompts.

import { addPrompt, editPrompt, renderPromptsManagementList } from './prompts.js';

/**
 * Initializes the prompt modal: sets up event listeners for opening, closing,
 * and saving a new prompt.
 */
export function initPromptModal() {
  const modal = document.getElementById('prompt-modal');
  const openBtn = document.getElementById('manage-prompts-btn');
  const closeBtn = modal.querySelector('.close');
  const saveBtn = document.getElementById('save-prompt');
  const cancelEditBtn = document.getElementById('cancel-edit');
  const promptNameInput = document.getElementById('new-prompt-name');
  const promptTextInput = document.getElementById('new-prompt-text');

  // Function to clear the modal inputs and editing state
  function clearModalInputs() {
    promptNameInput.value = '';
    promptTextInput.value = '';
    saveBtn.removeAttribute('data-editing');
    saveBtn.textContent = 'Save Prompt';
    cancelEditBtn.style.display = 'none';
  }

  // Show modal when clicking "Manage Prompts" button
  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    // Render the management list when the modal opens
    renderPromptsManagementList();
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

  // Save new prompt or update existing prompt when clicking the "Save Prompt" button
  saveBtn.addEventListener('click', () => {
    const name = promptNameInput.value.trim();
    const text = promptTextInput.value.trim();
    if (!name || !text) {
      alert('Please fill in both the prompt name and text.');
      return;
    }
    // Check if we are in edit mode (data-editing attribute exists)
    const editingName = saveBtn.getAttribute('data-editing');
    if (editingName) {
      editPrompt(editingName, name, text);
    } else {
      addPrompt(name, text);
    }
    clearModalInputs();
    // Re-render the management list after saving
    renderPromptsManagementList();
  });

  // Cancel editing mode when clicking the "Cancel Edit" button
  cancelEditBtn.addEventListener('click', () => {
    clearModalInputs();
  });
}
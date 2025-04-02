// public/js/whitelist.js
// Manages the whitelist for allowed file extensions.
// Provides functions to load, save, render, add, and remove whitelist entries.

import { state, saveStateToLocalStorage } from './state.js';

/**
 * Renders the management list of whitelisted file extensions as a table.
 * Each row displays the extension and a delete button in separate columns.
 * The table does not include header rows and only shows row lines for a cleaner look.
 */
export function renderWhitelistManagementList() {
  const container = document.getElementById('whitelist-management-list');
  container.innerHTML = '';

  // Create table element
  const table = document.createElement('table');
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  // Populate table rows with whitelist items without header row
  Array.from(state.whitelist).forEach((extension) => {
    const row = document.createElement('tr');

    // Extension cell
    const tdExtension = document.createElement('td');
    tdExtension.textContent = extension;
    tdExtension.style.border = "1px solid #3a3a3c";
    tdExtension.style.padding = "5px";

    // Action cell with delete button
    const tdAction = document.createElement('td');
    tdAction.style.border = "1px solid #3a3a3c";
    tdAction.style.padding = "5px";
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.style.margin = "0"; // Remove extra margins for better alignment
    deleteButton.addEventListener('click', () => {
      removeWhitelistValue(extension);
    });
    tdAction.appendChild(deleteButton);

    row.appendChild(tdExtension);
    row.appendChild(tdAction);
    table.appendChild(row);
  });

  container.appendChild(table);
}

/**
 * Adds a new whitelist extension or pattern.
 * @param {string} extension - The file extension or pattern to add.
 */
export function addWhitelistValue(extension) {
  extension = extension.trim();
  if (!extension) {
    alert('Please enter a valid file extension or pattern.');
    return;
  }
  // Allow any pattern (non-extensions as well as extensions)
  if (state.whitelist.has(extension.toLowerCase())) {
    alert('This extension or pattern is already whitelisted.');
    return;
  }
  state.whitelist.add(extension.toLowerCase());
  saveStateToLocalStorage();
  renderWhitelistManagementList();
}

/**
 * Removes a whitelist extension or pattern.
 * @param {string} extension - The file extension or pattern to remove.
 */
export function removeWhitelistValue(extension) {
  if (state.whitelist.has(extension)) {
    state.whitelist.delete(extension);
    saveStateToLocalStorage();
    renderWhitelistManagementList();
  }
}

/**
 * Initializes the whitelist modal.
 * Sets up event listeners for opening, closing, and saving new whitelist entries.
 */
export function initWhitelistModal() {
  const modal = document.getElementById('whitelist-modal');
  const openBtn = document.getElementById('manage-whitelist-btn');
  const closeBtn = modal.querySelector('.close');
  const saveBtn = document.getElementById('save-whitelist');
  const inputField = document.getElementById('new-whitelist-value');
  
  // Function to clear the input field
  function clearModalInput() {
    inputField.value = '';
  }
  
  openBtn.addEventListener('click', () => {
    modal.style.display = 'block';
    renderWhitelistManagementList();
  });
  
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    clearModalInput();
  });
  
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
      clearModalInput();
    }
  });
  
  saveBtn.addEventListener('click', () => {
    const newExtension = inputField.value;
    if (!newExtension) {
      alert('Please enter a file extension or pattern.');
      return;
    }
    addWhitelistValue(newExtension);
    clearModalInput();
  });
}
// public/js/utils.js
// Contains utility helper functions.

/**
 * Determines the programming language based on a file's extension.
 * @param {string} fileName - The name of the file.
 * @returns {string} - The language identifier.
 */
export function getLanguage(fileName) {
    if (fileName.endsWith('.py')) return 'py';
    if (fileName.endsWith('.html')) return 'html';
    if (fileName.endsWith('.css')) return 'css';
    if (fileName.endsWith('.js')) return 'js';
    if (fileName.endsWith('.md')) return 'md';
    return '';
  }
  
  /**
   * Debounce function to limit the rate at which a function is called.
   * @param {Function} func - The function to debounce.
   * @param {number} wait - The wait time in milliseconds.
   * @returns {Function} - The debounced function.
   */
  export function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
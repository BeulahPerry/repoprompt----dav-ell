// public/js/connection.js
// Handles server connection checks with protocol fallback.

import { state } from './state.js';
import { loadPromptsFromStorage } from './prompts.js';
import { generateFileExplorer } from './explorer.js';

/**
 * Attempts to fetch a URL via HTTPS and falls back to HTTP if needed.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<Response>} - The fetch response.
 */
export async function tryFetchWithFallback(url) {
  let response;
  // Include custom header to bypass ngrok warning page
  const fetchOptions = {
    headers: {
      "ngrok-skip-browser-warning": "true"
    }
  };
  try {
    console.log(`Trying HTTPS: ${url}`);
    response = await fetch(url, fetchOptions);
    if (response.ok) return response;
    throw new Error(`HTTPS failed with status ${response.status}`);
  } catch (httpsError) {
    console.log(`HTTPS attempt failed: ${httpsError.message}`);
  }
  const httpUrl = url.replace('https://', 'http://');
  console.log(`Falling back to HTTP: ${httpUrl}`);
  response = await fetch(httpUrl, fetchOptions);
  return response;
}

/**
 * Checks the server connection, updates the UI, and triggers prompt loading and file explorer refresh.
 */
export async function checkConnection() {
  let endpointInput = document.getElementById('endpoint-url').value.trim() || "localhost:3000";
  const statusElement = document.getElementById('connection-status');

  statusElement.textContent = "Connecting...";
  statusElement.style.color = "#e0e0e0";

  if (!endpointInput.startsWith('http://') && !endpointInput.startsWith('https://')) {
    endpointInput = `https://${endpointInput}`;
  }

  try {
    console.log(`Attempting to connect to: ${endpointInput}/api/connect`);
    const response = await tryFetchWithFallback(`${endpointInput}/api/connect`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server responded with status ${response.status}: ${text.slice(0, 50)}...`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Unexpected content type '${contentType}': ${text.slice(0, 50)}...`);
    }

    const data = await response.json();

    if (data.success) {
      if (endpointInput.startsWith('https://') && response.url.startsWith('http://')) {
        state.baseEndpoint = response.url.split('/api/connect')[0];
      } else {
        state.baseEndpoint = endpointInput;
      }
      statusElement.textContent = "Connected";
      statusElement.style.color = "#00ff00";
      console.log(`Successfully connected to ${state.baseEndpoint}`);
      await loadPromptsFromStorage();
      await generateFileExplorer();
      import('./state.js').then(module => {
        module.saveStateToLocalStorage();
      });
    } else {
      statusElement.textContent = `Failed: ${data.error}`;
      statusElement.style.color = "#ff0000";
      console.error(`Connection failed: ${data.error}`);
    }
  } catch (error) {
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.style.color = "#ff0000";
    console.error(`Connection error: ${error.message}`);
  }
}
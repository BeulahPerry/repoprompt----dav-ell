// public/script.js
// This script has been refactored for better modularity, error handling, and to reduce global scope pollution.
(function() {
  'use strict';

  // Root directory is now initialized as null and must be set by user
  let rootDirectory = null;
  // Base endpoint URL (mutable; updated by the connect button)
  let baseEndpoint = "http://localhost:3000";

  // State management
  const state = {
    fileCache: new Map(), // Cache for file contents
    selectedTree: {},     // Current selected file tree (object for proper nesting)
    collapsedFolders: new Set(), // Track collapsed folder paths
    userInstructions: "No instructions provided.",
    debounceTimer: null   // Debounce timer reference
  };

  // LocalStorage keys
  const STORAGE_KEYS = {
    DIRECTORY_PATH: 'repoPrompt_directoryPath',
    ENDPOINT_URL: 'repoPrompt_endpointUrl',
    PROMPT_SELECTION: 'repoPrompt_promptSelection',
    FILE_SELECTION: 'repoPrompt_fileSelection',
    COLLAPSED_FOLDERS: 'repoPrompt_collapsedFolders'
  };

  /**
   * Helper function to determine language based on file extension.
   * @param {string} fileName - The name of the file.
   * @returns {string} - The language identifier.
   */
  const getLanguage = (fileName) => {
    if (fileName.endsWith('.py')) return 'py';
    if (fileName.endsWith('.html')) return 'html';
    if (fileName.endsWith('.css')) return 'css';
    if (fileName.endsWith('.js')) return 'js';
    if (fileName.endsWith('.md')) return 'md';
    return '';
  };

  /**
   * Recursively renders the file tree into an HTML unordered list.
   * Now includes collapse/expand toggles and respects collapsed state.
   * @param {Object} tree - The file tree object.
   * @param {string} parentPath - The parent path.
   * @param {boolean} isRoot - Flag indicating whether to wrap in <ul> or not.
   * @returns {string} - The HTML string representing the file tree.
   */
  const renderFileTree = (tree, parentPath = "", isRoot = false) => {
    let html = isRoot ? "" : '<ul>';
    for (let key in tree) {
      if (tree[key].type === "file") {
        html += `<li data-file="${tree[key].path}">${key}</li>`;
      } else if (tree[key].type === "folder") {
        const folderPath = tree[key].path;
        const isCollapsed = state.collapsedFolders.has(folderPath);
        html += `<li data-folder="${folderPath}" ${isCollapsed ? 'class="collapsed"' : ''}>`;
        html += `<span class="folder-toggle">${isCollapsed ? '+' : '-'}</span>${key}`;
        html += renderFileTree(tree[key].children, folderPath);
        html += `</li>`;
      }
    }
    html += isRoot ? "" : '</ul>';
    return html;
  };

  /**
   * Saves current application state to localStorage
   */
  const saveStateToLocalStorage = () => {
    localStorage.setItem(STORAGE_KEYS.DIRECTORY_PATH, rootDirectory || '');
    localStorage.setItem(STORAGE_KEYS.ENDPOINT_URL, baseEndpoint);
    
    const promptSelection = {
      codeMap: document.getElementById('prompt-code-map').checked,
      enhance: document.getElementById('prompt-enhance').checked,
      debug: document.getElementById('prompt-debug').checked
    };
    localStorage.setItem(STORAGE_KEYS.PROMPT_SELECTION, JSON.stringify(promptSelection));

    const selectedPaths = getSelectedPaths(state.selectedTree);
    localStorage.setItem(STORAGE_KEYS.FILE_SELECTION, JSON.stringify(selectedPaths));

    localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify([...state.collapsedFolders]));
  };

  /**
   * Loads application state from localStorage
   */
  const loadStateFromLocalStorage = () => {
    const savedDirectory = localStorage.getItem(STORAGE_KEYS.DIRECTORY_PATH);
    if (savedDirectory) {
      rootDirectory = savedDirectory;
      document.getElementById('directory-path').value = savedDirectory;
    }

    const savedEndpoint = localStorage.getItem(STORAGE_KEYS.ENDPOINT_URL);
    if (savedEndpoint) {
      baseEndpoint = savedEndpoint;
      document.getElementById('endpoint-url').value = savedEndpoint;
    }

    const savedPrompts = localStorage.getItem(STORAGE_KEYS.PROMPT_SELECTION);
    if (savedPrompts) {
      const prompts = JSON.parse(savedPrompts);
      document.getElementById('prompt-code-map').checked = prompts.codeMap;
      document.getElementById('prompt-enhance').checked = prompts.enhance;
      document.getElementById('prompt-debug').checked = prompts.debug;
    }

    const savedCollapsed = localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS);
    if (savedCollapsed) {
      state.collapsedFolders = new Set(JSON.parse(savedCollapsed));
    }

    // File selections will be applied after directory loads
  };

  /**
   * Gets all selected paths from the tree
   * @param {Object} tree - The file tree object
   * @returns {string[]} - Array of selected paths
   */
  const getSelectedPaths = (tree) => {
    let paths = [];
    for (let key in tree) {
      const node = tree[key];
      if (node.type === 'file') {
        paths.push(node.path);
      } else if (node.type === 'folder') {
        paths.push(node.path);
        paths = paths.concat(getSelectedPaths(node.children));
      }
    }
    return paths;
  };

  /**
   * Applies saved file selections to the file tree
   * @param {string[]} savedPaths - Array of paths to select
   */
  const applySavedFileSelections = (savedPaths) => {
    const fileList = document.getElementById('file-list');
    const allItems = fileList.querySelectorAll('li[data-file], li[data-folder]');
    
    allItems.forEach(item => {
      const path = item.getAttribute('data-file') || item.getAttribute('data-folder');
      if (savedPaths.includes(path)) {
        item.classList.add('selected');
        item.dataset.userClicked = true;
      }
    });
    
    state.selectedTree = buildSelectedTree(fileList);
  };

  /**
   * Generates the file explorer by fetching directory contents from the server.
   */
  const generateFileExplorer = async () => {
    const fileListElement = document.getElementById('file-list');
    if (!rootDirectory) {
      fileListElement.innerHTML = '<ul><li>Please specify a directory path</li></ul>';
      return;
    }

    fileListElement.innerHTML = '<ul><li>Loading...</li></ul>';

    try {
      console.log(`Fetching directory: ${rootDirectory} from ${baseEndpoint}`);
      const response = await fetch(`${baseEndpoint}/api/directory?path=${encodeURIComponent(rootDirectory)}`);
      const data = await response.json();

      if (data.success) {
        rootDirectory = data.root;
        state.fileCache.clear(); // Clear cache when directory changes
        // Render without extra wrapping for the root level.
        fileListElement.innerHTML = renderFileTree(data.tree, "", true);
        console.log('File explorer updated successfully');
        
        // Apply saved selections after loading
        const savedSelections = localStorage.getItem(STORAGE_KEYS.FILE_SELECTION);
        if (savedSelections) {
          applySavedFileSelections(JSON.parse(savedSelections));
        } else {
          state.selectedTree = buildSelectedTree(fileListElement);
        }
        
        await updateXMLPreview(true); // Force full update on initial load
        saveStateToLocalStorage(); // Save after successful load
      } else {
        let errorMsg = data.error;
        if (errorMsg.includes("permission denied")) {
          errorMsg = `Permission denied: The server cannot access ${rootDirectory}. Ensure the server has read permissions.`;
        }
        fileListElement.innerHTML = `<ul><li>Error: ${errorMsg}</li></ul>`;
        console.error('Failed to load directory:', data.error);
      }
    } catch (error) {
      fileListElement.innerHTML = `<ul><li>Error: Network error - ${error.message}</li></ul>`;
      console.error('Network error:', error.message);
    }
  };

  /**
   * Builds a file tree based on selected items in the file explorer.
   * @param {HTMLElement} ulElement - The unordered list element containing file items.
   * @param {string} parentPath - The parent directory path.
   * @returns {Object} - The selected file tree.
   */
  const buildSelectedTree = (ulElement, parentPath = rootDirectory) => {
    const tree = {};
    const liElements = ulElement.querySelectorAll(':scope > li');

    liElements.forEach(li => {
      const isSelected = li.classList.contains("selected");

      if (li.hasAttribute("data-file") && isSelected) {
        const filePath = li.getAttribute("data-file");
        const fileName = filePath.split("/").pop();
        tree[fileName] = { type: "file", path: filePath };
      }

      if (li.hasAttribute("data-folder")) {
        let folderName = li.firstChild.nodeType === Node.TEXT_NODE ? li.firstChild.textContent.trim() : li.childNodes[1].textContent.trim();
        const folderPath = li.getAttribute("data-folder");
        const nestedUl = li.querySelector(":scope > ul");
        const children = nestedUl ? buildSelectedTree(nestedUl, folderPath) : {};

        // Count total children and selected children
        const allChildren = nestedUl ? nestedUl.querySelectorAll('li') : [];
        const selectedChildren = nestedUl ? nestedUl.querySelectorAll('li.selected') : [];
        const allSelected = allChildren.length > 0 && allChildren.length === selectedChildren.length;

        if (isSelected || Object.keys(children).length > 0) {
          tree[folderName] = {
            type: "folder",
            path: folderPath,
            children: children
          };
          // Update folder's selection status based on children
          if (allSelected && !isSelected) {
            li.classList.add("selected");
          } else if (!allSelected && isSelected && !li.dataset.userClicked) {
            li.classList.remove("selected");
          }
        }
      }
    });
    return tree;
  };

  /**
   * Recursively formats a file tree object into a string with branch symbols.
   * @param {Object} tree - The file tree object.
   * @param {string} prefix - The current prefix for formatting.
   * @returns {Array<string>} - An array of strings representing the file tree.
   */
  const formatTree = (tree, prefix = "") => {
    let lines = [];
    const entries = Object.entries(tree);

    entries.forEach(([name, node], index) => {
      const isLast = index === entries.length - 1;
      const branch = isLast ? "└── " : "├── ";
      lines.push(prefix + branch + name);

      if (node.type === "folder" && node.children && Object.keys(node.children).length > 0) {
        const newPrefix = prefix + (isLast ? "    " : "│   ");
        lines = lines.concat(formatTree(node.children, newPrefix));
      }
    });
    return lines;
  };

  /**
   * Retrieves a flat list of all file nodes from a file tree.
   * @param {Object} tree - The file tree object.
   * @returns {Array<Object>} - Array of file nodes.
   */
  const getFileNodes = (tree) => {
    let files = [];
    for (let key in tree) {
      const node = tree[key];
      if (node.type === "file") files.push(node);
      else if (node.type === "folder" && node.children) {
        files = files.concat(getFileNodes(node.children));
      }
    }
    return files;
  };

  /**
   * Fetches file content from the server and caches the result.
   * @param {Object} fileNode - The file node object.
   * @returns {Promise<string>} - The file content wrapped in a markdown code block.
   */
  const fetchFileContent = async (fileNode) => {
    if (state.fileCache.has(fileNode.path)) {
      console.log(`Using cached content for: ${fileNode.path}`);
      return state.fileCache.get(fileNode.path);
    }

    const lang = getLanguage(fileNode.path);
    console.log(`Fetching file: ${fileNode.path}`);
    try {
      const response = await fetch(`${baseEndpoint}/api/file?path=${encodeURIComponent(fileNode.path)}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();

      if (data.success) {
        const content = `File: ${fileNode.path}\n\`\`\`${lang}\n${data.content}\n\`\`\`\n\n`;
        state.fileCache.set(fileNode.path, content);
        console.log(`Successfully fetched and cached: ${fileNode.path}`);
        return content;
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error(`Fetch error for ${fileNode.path}: ${error.message}`);
      const errorContent = `File: ${fileNode.path}\n\`\`\`${lang}\n<!-- Error: ${error.message} -->\n\`\`\`\n\n`;
      state.fileCache.set(fileNode.path, errorContent);
      return errorContent;
    }
  };

  /**
   * Generates XML output for file mapping and file contents and updates the preview.
   * @param {boolean} forceFullUpdate - Whether to force a full update.
   */
  const updateXMLPreview = async (forceFullUpdate = false) => {
    console.log('Updating XML preview...');

    // File map section
    let fileMapStr = `<file_map>\n${rootDirectory || 'No directory specified'}\n`;
    if (Object.keys(state.selectedTree).length > 0) {
      const treeLines = formatTree(state.selectedTree);
      treeLines.forEach(line => fileMapStr += line + "\n");
    } else {
      fileMapStr += "<!-- No files selected -->\n";
    }
    fileMapStr += `</file_map>`;

    // File contents section
    let fileContentsStr = `<file_contents>\n`;
    const fileNodes = getFileNodes(state.selectedTree);
    if (fileNodes.length > 0) {
      console.log(`Processing contents for ${fileNodes.length} files`);
      const fileContentsArray = await Promise.all(fileNodes.map(fileNode => fetchFileContent(fileNode)));
      fileContentsStr += fileContentsArray.join('');
    } else {
      console.log('No files selected for content fetching');
      fileContentsStr += `<!-- No file contents available -->\n`;
    }
    fileContentsStr += `</file_contents>`;

    // Meta and instructions section
    const metaPromptStr = `<meta prompt 1="Don't be lazy">\n${(typeof metaPromptText !== 'undefined' ? metaPromptText : '')}\n</meta prompt 1>`;
    const userInstructionsStr = `<user_instructions>\n${state.userInstructions}\n</user_instructions>`;

    const finalXML = `${fileMapStr}\n\n${fileContentsStr}\n\n${metaPromptStr}\n${userInstructionsStr}`;
    document.getElementById('xml-output').textContent = finalXML;
    console.log('XML preview updated');
    saveStateToLocalStorage(); // Save state after update
  };

  /**
   * Utility function to debounce calls.
   * @param {Function} func - The function to debounce.
   * @param {number} wait - The debounce wait time in milliseconds.
   * @returns {Function} - The debounced function.
   */
  const debounce = (func, wait) => {
    return function(...args) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => func.apply(this, args), wait);
    };
  };

  /**
   * Selects or deselects all children of a folder recursively
   * @param {HTMLElement} li - The folder li element
   * @param {boolean} select - Whether to select or deselect
   */
  const toggleFolderChildren = (li, select) => {
    const children = li.querySelectorAll(':scope > ul > li');
    children.forEach(child => {
      if (select) {
        child.classList.add('selected');
      } else {
        child.classList.remove('selected');
      }
      if (child.hasAttribute('data-folder')) {
        toggleFolderChildren(child, select);
      }
    });
  };

  /**
   * Toggles the collapse state of a folder
   * @param {HTMLElement} li - The folder li element
   */
  const toggleFolderCollapse = (li) => {
    const folderPath = li.getAttribute('data-folder');
    const isCollapsed = li.classList.contains('collapsed');
    const toggleSpan = li.querySelector('.folder-toggle');

    if (isCollapsed) {
      li.classList.remove('collapsed');
      toggleSpan.textContent = '-';
      state.collapsedFolders.delete(folderPath);
    } else {
      li.classList.add('collapsed');
      toggleSpan.textContent = '+';
      state.collapsedFolders.add(folderPath);
    }
    saveStateToLocalStorage();
  };

  /**
   * Handles file/folder selection and collapse/expand using event delegation.
   * @param {Event} event - The click event.
   */
  const handleFileSelection = (event) => {
    const target = event.target;
    const li = target.closest('li');
    if (!li) return;

    // Handle folder toggle if clicking the toggle button or folder name
    if (li.hasAttribute('data-folder') && (target.classList.contains('folder-toggle') || target.nodeType === Node.TEXT_NODE || target.tagName === 'LI')) {
      toggleFolderCollapse(li);
      return;
    }

    // Handle selection for files or folders when clicking elsewhere
    if (!li.hasAttribute('data-file') && !li.hasAttribute('data-folder')) return;

    const isFolder = li.hasAttribute('data-folder');
    const wasSelected = li.classList.contains('selected');
    
    // Toggle selection
    li.classList.toggle('selected');
    li.dataset.userClicked = true; // Mark as user-initiated click

    if (isFolder) {
      // Select/deselect all children when folder is clicked
      toggleFolderChildren(li, !wasSelected);
    }

    console.log(`Toggled selection for: ${li.textContent.trim()}`);
    state.selectedTree = buildSelectedTree(document.getElementById('file-list'));
    updateXMLPreview(true); // Force full update when selection changes
  };

  /**
   * Copies the XML output to the clipboard and shows a fading "copied!" message.
   */
  const copyXMLToClipboard = () => {
    const xmlText = document.getElementById('xml-output').textContent;
    const feedbackElement = document.getElementById('copy-feedback');
    
    navigator.clipboard.writeText(xmlText)
      .then(() => {
        // Show the "copied!" message and fade it out
        feedbackElement.classList.add('show');
        console.log('XML copied to clipboard');
        
        // Remove the 'show' class after animation completes
        setTimeout(() => {
          feedbackElement.classList.remove('show');
        }, 1000); // Matches the 0.5s fade-out plus some buffer
      })
      .catch(err => console.error('Failed to copy XML: ', err));
  };

  /**
   * Attempts to fetch a URL first via HTTPS and then falls back to HTTP if needed.
   * @param {string} url - The URL to fetch.
   * @returns {Promise<Response>} - The fetch response.
   */
  const tryFetchWithFallback = async (url) => {
    let response;

    try {
      console.log(`Trying HTTPS: ${url}`);
      response = await fetch(url);
      if (response.ok) return response;
      throw new Error(`HTTPS failed with status ${response.status}`);
    } catch (httpsError) {
      console.log(`HTTPS attempt failed: ${httpsError.message}`);
    }

    const httpUrl = url.replace('https://', 'http://');
    console.log(`Falling back to HTTP: ${httpUrl}`);
    response = await fetch(httpUrl);
    return response;
  };

  /**
   * Checks the server connection with protocol fallback and updates the connection status in the UI.
   */
  const checkConnection = async () => {
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
        baseEndpoint = (endpointInput.startsWith('https://') && response.url.startsWith('http://'))
          ? response.url.split('/api/connect')[0]
          : endpointInput;
        statusElement.textContent = "Connected";
        statusElement.style.color = "#00ff00";
        console.log(`Successfully connected to ${baseEndpoint}`);
        await generateFileExplorer();
        saveStateToLocalStorage(); // Save after successful connection
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
  };

  // Attach event listeners after DOM content has loaded
  document.addEventListener('DOMContentLoaded', () => {
    loadStateFromLocalStorage(); // Load saved state first
    generateFileExplorer(); // Will use loaded directory or show "Please specify"

    const debouncedUpdate = debounce(() => {
      state.userInstructions = document.getElementById('user-instructions').value.trim() || "No instructions provided.";
      updateXMLPreview();
    }, 500); // 500ms debounce

    document.getElementById('user-instructions').addEventListener('input', debouncedUpdate);
    document.querySelectorAll('.prompt-selection input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        updateXMLPreview();
        saveStateToLocalStorage(); // Save prompt selection changes
      });
    });
    document.getElementById('file-list').addEventListener('click', handleFileSelection);
    document.getElementById('copy-btn').addEventListener('click', copyXMLToClipboard);

    document.getElementById('update-directory').addEventListener('click', async function() {
      rootDirectory = document.getElementById('directory-path').value.trim();
      if (!rootDirectory) {
        alert('Please enter a valid directory path');
        return;
      }
      console.log(`Updating directory to: ${rootDirectory}`);
      await generateFileExplorer();
      saveStateToLocalStorage(); // Save after directory update
    });

    document.getElementById('connect-endpoint').addEventListener('click', checkConnection);
  });
})();
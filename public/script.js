// public/script.js
// Root directory (mutable; updated by the update button)
let rootDirectory = "/Users/davell/Documents/github/repoprompt";

// Helper function to determine language based on file extension
function getLanguage(fileName) {
  if (fileName.endsWith('.py')) return 'py';
  if (fileName.endsWith('.html')) return 'html';
  if (fileName.endsWith('.css')) return 'css';
  if (fileName.endsWith('.js')) return 'js';
  if (fileName.endsWith('.md')) return 'md';
  return '';
}

// Render the tree object into HTML list items
function renderFileTree(tree, parentPath = "") {
  let html = '<ul>';
  for (let key in tree) {
    if (tree[key].type === "file") {
      html += `<li data-file="${tree[key].path}">${key}</li>`;
    } else if (tree[key].type === "folder") {
      html += `<li data-folder="${parentPath ? parentPath + '/' + key : key}">${key}`;
      html += renderFileTree(tree[key].children, tree[key].path);
      html += `</li>`;
    }
  }
  html += '</ul>';
  return html;
}

// Fetch and generate the file explorer
async function generateFileExplorer() {
  const fileListElement = document.getElementById('file-list');
  fileListElement.innerHTML = '<ul><li>Loading...</li></ul>';
  
  try {
    console.log(`Fetching directory: ${rootDirectory}`);
    const response = await fetch(`/api/directory?path=${encodeURIComponent(rootDirectory)}`);
    const data = await response.json();
    
    if (data.success) {
      rootDirectory = data.root;
      fileListElement.innerHTML = renderFileTree(data.tree);
      console.log('File explorer updated successfully');
    } else {
      fileListElement.innerHTML = `<ul><li>Error: ${data.error}</li></ul>`;
      console.error('Failed to load directory:', data.error);
    }
  } catch (error) {
    fileListElement.innerHTML = `<ul><li>Error: Network error - ${error.message}</li></ul>`;
    console.error('Network error:', error.message);
  }
}

// Build tree from file explorer for selected items
function buildSelectedTree(ulElement, forceInclude = false) {
  let nodes = [];
  const liElements = ulElement.querySelectorAll('li');
  
  for (let li of liElements) {
    let isSelected = li.classList.contains("selected") || forceInclude;
    let node = null;
    
    if (li.hasAttribute("data-file") && isSelected) {
      const filePath = li.getAttribute("data-file");
      node = { name: filePath.split("/").pop(), type: "file", path: filePath };
    }
    
    if (li.hasAttribute("data-folder")) {
      const folderPath = li.getAttribute("data-folder");
      const nestedUl = li.querySelector(":scope > ul");
      let childrenNodes = [];
      
      if (nestedUl) {
        childrenNodes = buildSelectedTree(nestedUl, forceInclude && isSelected);
      }
      
      if (isSelected || childrenNodes.length > 0) {
        node = { name: folderPath.split("/").pop(), type: "folder", path: folderPath, children: childrenNodes };
      }
    }
    
    if (node) nodes.push(node);
  }
  return nodes;
}

// Format tree nodes into a string
function formatTree(nodes, prefix = "") {
  let lines = [];
  nodes.forEach((node, index) => {
    const isLast = (index === nodes.length - 1);
    const branch = isLast ? "└── " : "├── ";
    lines.push(prefix + branch + node.name);
    if (node.type === "folder" && node.children && node.children.length > 0) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      lines = lines.concat(formatTree(node.children, newPrefix));
    }
  });
  return lines;
}

// Get flat list of file nodes
function getFileNodes(nodes) {
  let files = [];
  nodes.forEach(node => {
    if (node.type === "file") files.push(node);
    else if (node.type === "folder" && node.children) {
      files = files.concat(getFileNodes(node.children));
    }
  });
  return files;
}

// Generate XML output and update preview
async function updateXMLPreview() {
  console.log('Updating XML preview...');
  const userInstructions = document.getElementById('user-instructions').value.trim() || "No instructions provided.";
  const fileListElement = document.getElementById('file-list');
  const selectedTree = buildSelectedTree(fileListElement);
  
  let fileMapStr = `<file_map>\n${rootDirectory}\n`;
  if (selectedTree.length > 0) {
    const treeLines = formatTree(selectedTree);
    treeLines.forEach(line => fileMapStr += line + "\n");
  } else {
    fileMapStr += "<!-- No files selected -->\n";
  }
  fileMapStr += `</file_map>`;
  
  // Fetch file contents concurrently
  const fileNodes = getFileNodes(selectedTree);
  let fileContentsStr = `<file_contents>\n`;
  if (fileNodes.length > 0) {
    console.log(`Fetching contents for ${fileNodes.length} files`);
    const fileFetchPromises = fileNodes.map(fileNode => {
      const lang = getLanguage(fileNode.path);
      console.log(`Fetching file: ${fileNode.path}`);
      return fetch(`/api/file?path=${encodeURIComponent(fileNode.path)}`)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return response.json();
        })
        .then(data => {
          if (data.success) {
            console.log(`Successfully fetched: ${fileNode.path}`);
            return `File: ${fileNode.path}\n\`\`\`${lang}\n${data.content}\n\`\`\`\n\n`;
          } else {
            console.error(`Server error for ${fileNode.path}: ${data.error}`);
            return `File: ${fileNode.path}\n\`\`\`${lang}\n<!-- Error: ${data.error} -->\n\`\`\`\n\n`;
          }
        })
        .catch(error => {
          console.error(`Fetch error for ${fileNode.path}: ${error.message}`);
          return `File: ${fileNode.path}\n\`\`\`${lang}\n<!-- Error: Network error - ${error.message} -->\n\`\`\`\n\n`;
        });
    });
    const fileContentsArray = await Promise.all(fileFetchPromises);
    fileContentsStr += fileContentsArray.join('');
  } else {
    console.log('No files selected for content fetching');
    fileContentsStr += `<!-- No file contents available -->\n`;
  }
  fileContentsStr += `</file_contents>`;
  
  // Ensure metaPromptText is defined, otherwise use an empty string
  const metaPromptStr = `<meta prompt 1="Don't be lazy">\n${typeof metaPromptText !== 'undefined' ? metaPromptText : ''}\n</meta prompt 1>`;
  const userInstructionsStr = `<user_instructions>\n${userInstructions}\n</user_instructions>`;
  
  const finalXML = `${fileMapStr}\n\n${fileContentsStr}\n\n${metaPromptStr}\n${userInstructionsStr}`;
  document.getElementById('xml-output').textContent = finalXML;
  console.log('XML preview updated');
}

// Handle file/folder selection with delegation
function handleFileSelection(event) {
  const target = event.target.closest('li');
  if (target && (target.hasAttribute('data-file') || target.hasAttribute('data-folder'))) {
    target.classList.toggle('selected');
    console.log(`Toggled selection for: ${target.textContent.trim()}`);
    updateXMLPreview();
  }
}

// Copy XML to clipboard
function copyXMLToClipboard() {
  const xmlText = document.getElementById('xml-output').textContent;
  navigator.clipboard.writeText(xmlText)
    .then(() => {
      alert('XML copied to clipboard!');
      console.log('XML copied to clipboard');
    })
    .catch(err => console.error('Failed to copy XML: ', err));
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  generateFileExplorer();
  
  document.getElementById('user-instructions').addEventListener('input', updateXMLPreview);
  document.querySelectorAll('.prompt-selection input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', updateXMLPreview);
  });
  document.getElementById('file-list').addEventListener('click', handleFileSelection);
  document.getElementById('copy-btn').addEventListener('click', copyXMLToClipboard);
  
  document.getElementById('update-directory').addEventListener('click', async function() {
    rootDirectory = document.getElementById('directory-path').value.trim() || "/Users/davell/Documents/github/repoprompt";
    console.log(`Updating directory to: ${rootDirectory}`);
    await generateFileExplorer();
    updateXMLPreview();
  });
  
  updateXMLPreview();
});
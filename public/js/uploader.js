// public/js/uploader.js
// Handles the uploading and processing of a zip file or folder containing a directory.
// Uses JSZip (loaded from the CDN) to unzip and build a file tree with file contents for zip uploads,
// and uses the browser File API for folder uploads.

import { state, saveStateToLocalStorage } from './state.js';
import { renderFileTree } from './fileTree.js';
import { updateXMLPreview } from './xmlPreview.js';

/**
 * Handles the uploaded zip file.
 * @param {File} file - The uploaded zip file.
 */
export async function handleZipUpload(file) {
  try {
    const zip = await JSZip.loadAsync(file);
    const { tree, files } = await buildTreeFromZip(zip);
    state.rootDirectory = "Uploaded: " + file.name;
    state.uploadedFileTree = tree;
    state.uploadedFiles = files;
    // Update file explorer UI with the uploaded file tree
    document.getElementById('file-list').innerHTML = renderFileTree(tree, "", true);
    // Update XML preview with the new context
    await updateXMLPreview(true);
    saveStateToLocalStorage();
  } catch (err) {
    console.error("Error processing zip file: ", err);
    alert("Failed to process zip file: " + err.message);
  }
}

/**
 * Builds a file tree and file content dictionary from the loaded zip.
 * @param {JSZip} zip - The loaded zip object.
 * @returns {Object} - An object containing the file tree and files dictionary.
 */
async function buildTreeFromZip(zip) {
  const tree = {};
  const files = {}; // Mapping from file path to file content
  const filePaths = Object.keys(zip.files);
  for (const filePath of filePaths) {
    const fileObj = zip.files[filePath];
    if (fileObj.dir) {
      // For directories, add to tree
      addToTree(tree, filePath, true);
    } else {
      // For files, add to tree and extract content
      addToTree(tree, filePath, false);
      const content = await fileObj.async("text");
      files[filePath] = content;
    }
  }
  return { tree, files };
}

/**
 * Adds a file or directory to the tree structure.
 * @param {Object} tree - The current tree structure.
 * @param {string} filePath - The file path from the zip.
 * @param {boolean} isDir - Flag indicating whether the entry is a directory.
 */
function addToTree(tree, filePath, isDir) {
  const parts = filePath.split('/').filter(Boolean);
  let current = tree;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      // Last part of the path
      if (isDir) {
        current[part] = {
          type: "folder",
          path: filePath,
          children: {}
        };
      } else {
        current[part] = {
          type: "file",
          path: filePath
        };
      }
    } else {
      // Intermediate directory parts; ensure folder exists
      if (!current[part]) {
        current[part] = {
          type: "folder",
          path: parts.slice(0, i + 1).join('/'),
          children: {}
        };
      }
      current = current[part].children;
    }
  }
}

/**
 * Handles the uploaded folder.
 * Processes a folder selected via a file input (with webkitdirectory attribute)
 * and builds a file tree along with file contents.
 * @param {FileList} fileList - List of files selected from the folder.
 */
export async function handleFolderUpload(fileList) {
  try {
    const { tree, files: fileContents, baseFolder } = await buildTreeFromFolder(fileList);
    state.rootDirectory = "Uploaded: " + baseFolder;
    state.uploadedFileTree = tree;
    state.uploadedFiles = fileContents;
    // Update file explorer UI with the uploaded folder tree
    document.getElementById('file-list').innerHTML = renderFileTree(tree, "", true);
    // Update XML preview with the new context
    await updateXMLPreview(true);
    saveStateToLocalStorage();
  } catch (err) {
    console.error("Error processing folder upload: ", err);
    alert("Failed to process folder upload: " + err.message);
  }
}

/**
 * Builds a file tree and file content dictionary from the selected folder.
 * @param {FileList} fileList - The FileList from the folder upload input.
 * @returns {Object} - An object containing the file tree, files mapping, and base folder name.
 */
async function buildTreeFromFolder(fileList) {
  const tree = {};
  const files = {};
  let baseFolder = "";
  const fileArray = Array.from(fileList);
  
  // Determine base folder from the first file's webkitRelativePath
  if (fileArray.length > 0) {
    const firstPath = fileArray[0].webkitRelativePath;
    const parts = firstPath.split('/');
    baseFolder = parts.length > 1 ? parts[0] : "";
  }
  
  // Process each file: build the tree structure and read file content
  for (const file of fileArray) {
    const relativePath = file.webkitRelativePath;
    addToTreeFromFolder(tree, relativePath);
    const content = await file.text();
    files[relativePath] = content;
  }
  return { tree, files, baseFolder };
}

/**
 * Adds a file or folder to the tree structure based on its relative path.
 * @param {Object} tree - The current tree structure.
 * @param {string} relativePath - The relative path from the folder upload.
 */
function addToTreeFromFolder(tree, relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  let current = tree;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      // This is a file
      current[part] = {
        type: "file",
        path: relativePath
      };
    } else {
      // This is a folder
      if (!current[part]) {
        current[part] = {
          type: "folder",
          path: parts.slice(0, i + 1).join('/'),
          children: {}
        };
      }
      current = current[part].children;
    }
  }
}
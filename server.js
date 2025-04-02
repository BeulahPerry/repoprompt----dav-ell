// server.js
'use strict';

const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const fsConstants = require('fs').constants;
const path = require('path');
const ignore = require('ignore');
const cors = require('cors');
const dotenv = require('dotenv');
const chokidar = require('chokidar'); // Added for file monitoring
const compression = require('compression'); // Added compression middleware
const app = express();
const port = process.env.PORT || 3000;

// Load environment variables from .env file
dotenv.config();
console.log('PORT from .env:', process.env.PORT);

// Use compression middleware to improve performance with many files
app.use(compression());

// Increase the JSON body limit to handle large batch requests
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Utility function for logging
const log = (message, level = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
};

// Middleware to log incoming requests
app.use((req, res, next) => {
  log(`Incoming request: ${req.method} ${req.url} from ${req.ip}`, 'DEBUG');
  next();
});

// Middleware to log responses after they finish
app.use((req, res, next) => {
  res.on('finish', () => {
    log(`Response for ${req.method} ${req.url}: ${res.statusCode}`, 'DEBUG');
  });
  next();
});

// Helper function to validate and sanitize a given path
const validatePath = (requestedPath) => {
  // Resolve to absolute path to prevent relative path issues
  const resolvedPath = path.resolve(requestedPath);
  
  // Prevent path traversal by ensuring the resolved path doesn't go beyond root
  const root = path.resolve('/');
  if (!resolvedPath.startsWith(root)) {
    throw new Error('Invalid path: Path traversal detected.');
  }
  
  log(`Resolved path: ${resolvedPath}`, 'DEBUG');
  return resolvedPath;
};

// NEW: Helper function to compute the minimal set of directories to watch
function getMinimalDirs(filePaths) {
  const dirs = new Set();
  filePaths.forEach(file => {
    try {
      const dir = path.dirname(file);
      dirs.add(dir);
    } catch (e) {
      // Ignore errors in extracting dirname
    }
  });
  // Convert to an array and sort alphabetically
  const minimalDirs = Array.from(dirs).sort();
  const result = [];
  // Only add a directory if it is not a subdirectory of an already-added directory
  minimalDirs.forEach(dir => {
    if (!result.some(parent => dir === parent || dir.startsWith(parent + path.sep))) {
      result.push(dir);
    }
  });
  return result;
}

// Custom natural compare function for sorting
function naturalCompare(a, b) {
    const re = /(\d+)/g;
    const aParts = a.split(re);
    const bParts = b.split(re);

    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];

        // If both parts are numeric, compare as numbers
        if (/\d/.test(aPart) && /\d/.test(bPart)) {
            const aNum = parseInt(aPart, 10);
            const bNum = parseInt(bPart, 10);
            if (aNum !== bNum) {
                return aNum - bNum;
            }
        } else {
            // Otherwise, compare as strings (case-insensitive)
            const comparison = aPart.localeCompare(bPart, undefined, { sensitivity: 'base' });
            if (comparison !== 0) {
                return comparison;
            }
        }
    }

    // If one string is a prefix of the other, the shorter one comes first
    return aParts.length - bParts.length;
}

// Helper function to sort directory entries: folders first, then files, both in natural order
const sortDirents = (dirents) => {
  const folders = dirents.filter(dirent => dirent.isDirectory()).map(dirent => ({
    name: dirent.name,
    isDirectory: true
  }));
  const files = dirents.filter(dirent => !dirent.isDirectory()).map(dirent => ({
    name: dirent.name,
    isDirectory: false
  }));
  
  folders.sort((a, b) => naturalCompare(a.name, b.name));
  files.sort((a, b) => naturalCompare(a.name, b.name));
  
  return [...folders, ...files].map(item => dirents.find(d => d.name === item.name));
};

// NEW: Helper function to read files in chunks (concurrency limit)
async function readFilesInChunks(paths, chunkSize) {
  const filesResult = {};
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const promises = chunk.map(async filePath => {
      try {
        const validPath = validatePath(filePath);
        await fs.access(validPath, fsConstants.R_OK);
        const content = await fs.readFile(validPath, 'utf8');
        filesResult[filePath] = { success: true, content };
      } catch (error) {
        filesResult[filePath] = { success: false, error: error.message };
      }
    });
    await Promise.all(promises);
  }
  return filesResult;
}

// API to get directory contents
app.get('/api/directory', async (req, res) => {
  let requestedPath = req.query.path || process.cwd(); // Default to current working directory
  let dirPath;
  try {
    dirPath = validatePath(requestedPath);
  } catch (err) {
    log(`Path validation failed for ${requestedPath}: ${err.message}`, 'ERROR');
    return res.status(400).json({ success: false, error: err.message });
  }

  try {
    await fs.access(dirPath, fsConstants.R_OK); // Check read access
    log(`Processing directory: ${dirPath}`);

    let ig = ignore();
    const gitignorePath = path.join(dirPath, '.gitignore');
    try {
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
      ig = ignore().add(gitignoreContent);
      log('Found and applied .gitignore');
    } catch (error) {
      log('No .gitignore found, proceeding without filtering', 'INFO');
    }

    const files = await fs.readdir(dirPath, { withFileTypes: true });
    const filteredFiles = files.filter(dirent => {
      const relativePath = dirent.name;
      if (dirent.isDirectory()) return true;
      return !ig.ignores(relativePath);
    });
    const sortedFiles = sortDirents(filteredFiles); // Sort the entries

    const tree = await buildDirectoryTree(dirPath, sortedFiles, ig);
    res.json({ success: true, tree, root: dirPath });
  } catch (error) {
    const errorMsg = `Failed to read directory ${dirPath}: ${error.message}`;
    log(errorMsg, 'ERROR');
    res.status(400).json({ success: false, error: errorMsg });
  }
});

// Build directory tree recursively with .gitignore filtering
async function buildDirectoryTree(basePath, dirents, ig) {
  const tree = {};

  for (const dirent of dirents) {
    const fullPath = path.join(basePath, dirent.name);
    const relativePath = path.relative(basePath, fullPath);

    if (dirent.isDirectory()) {
      if (ig.ignores(relativePath + '/')) {
        log(`Skipping ignored directory: ${relativePath}`, 'DEBUG');
        continue;
      }

      try {
        const subDirents = await fs.readdir(fullPath, { withFileTypes: true });
        const filteredSubDirents = subDirents.filter(subDirent => {
          const subRelativePath = path.join(relativePath, subDirent.name);
          if (subDirent.isDirectory()) return true;
          return !ig.ignores(subRelativePath);
        });
        const sortedSubDirents = sortDirents(filteredSubDirents); // Sort sub-entries

        const subTree = await buildDirectoryTree(fullPath, sortedSubDirents, ig);
        if (Object.keys(subTree).length > 0) {
          tree[dirent.name] = {
            type: 'folder',
            path: fullPath,
            children: subTree
          };
        }
      } catch (error) {
        log(`Error reading subdirectory ${fullPath}: ${error.message}`, 'WARN');
      }
    } else {
      if (ig.ignores(relativePath)) {
        log(`Skipping ignored file: ${relativePath}`, 'DEBUG');
        continue;
      }

      tree[dirent.name] = {
        type: 'file',
        path: fullPath
      };
    }
  }
  return tree;
}

// API to get file contents
app.get('/api/file', async (req, res) => {
  let filePath = req.query.path;
  try {
    filePath = validatePath(filePath);
  } catch (err) {
    log(`Path validation failed for file ${req.query.path}: ${err.message}`, 'ERROR');
    return res.status(400).json({ success: false, error: err.message });
  }

  try {
    const content = await fs.readFile(filePath, 'utf8');
    log(`Successfully read file: ${filePath}`, 'DEBUG');
    res.json({ success: true, content });
  } catch (error) {
    const errorMsg = `Failed to read file ${filePath}: ${error.message}`;
    log(errorMsg, 'ERROR');
    res.status(400).json({ success: false, error: errorMsg });
  }
});

// NEW: API endpoint to fetch multiple files in a single request using chunked processing
app.post('/api/files', async (req, res) => {
  const paths = req.body.paths;
  if (!paths || !Array.isArray(paths)) {
    return res.status(400).json({ success: false, error: "Invalid request body: 'paths' array required." });
  }
  try {
    // Process file reads in chunks with a concurrency limit (e.g., 50)
    const filesResult = await readFilesInChunks(paths, 50);
    res.json({ success: true, files: filesResult });
  } catch (error) {
    log(`Error in batch file fetch: ${error.message}`, 'ERROR');
    res.status(500).json({ success: false, error: error.message });
  }
});

// API to check server connection status
app.get('/api/connect', (req, res) => {
  try {
    // Log connection check with client's IP address
    log(`Connection check requested from IP: ${req.ip}`, 'DEBUG');
    const responsePayload = { 
      success: true, 
      status: 'Server is running',
      timestamp: new Date().toISOString(),
      port: port
    };
    log(`Responding with payload: ${JSON.stringify(responsePayload)}`, 'DEBUG');
    res.json(responsePayload);
  } catch (error) {
    const errorMsg = `Connection check failed: ${error.message}`;
    log(errorMsg, 'ERROR');
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// NEW: API endpoint to provide configuration values
app.get('/api/config', (req, res) => {
  const refreshInterval = process.env.REFRESH_INTERVAL ? Number(process.env.REFRESH_INTERVAL) : 10000;
  res.json({ success: true, refreshInterval });
});

// NEW: SSE endpoint for file change monitoring using backend batching and filtering
app.get('/api/subscribe', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  // Parse and validate the directory parameter
  let directory;
  try {
    directory = validatePath(req.query.directory);
  } catch (e) {
    res.write(`event: error\ndata: Invalid directory parameter: ${e.message}\n\n`);
    return res.end();
  }

  // Expect the client to send a minimal list of directories (instead of thousands of file paths)
  let selectedDirs;
  try {
    selectedDirs = JSON.parse(req.query.files);
  } catch (e) {
    res.write(`event: error\ndata: Invalid files parameter\n\n`);
    return res.end();
  }

  log(`Received subscription for directories: ${selectedDirs.join(', ')}`, 'DEBUG');

  // Create a chokidar watcher on the minimal directories
  const watcher = chokidar.watch(selectedDirs, { ignoreInitial: true, persistent: true });

  // Setup batching for file change events with debouncing
  let batchedChanges = new Set();
  let debounceTimeout = null;

  watcher.on('all', (event, changedPath) => {
    // Check if the changedPath starts with any of the subscribed directories
    let matches = false;
    for (const dir of selectedDirs) {
      if (changedPath.startsWith(dir)) {
        matches = true;
        break;
      }
    }
    if (matches) {
      batchedChanges.add(changedPath);
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        const changedArray = Array.from(batchedChanges);
        res.write(`event: fileUpdate\ndata: ${JSON.stringify(changedArray)}\n\n`);
        batchedChanges.clear();
      }, 300);
    }
  });

  watcher.on('error', (error) => {
    res.write(`event: error\ndata: ${error.message}\n\n`);
  });

  // Cleanup when client disconnects
  req.on('close', () => {
    watcher.close();
    res.end();
  });
});

// Static files middleware (moved after API routes)
app.use(express.static('public'));

// 404 Handler
app.use((req, res, next) => {
  const errorMsg = `Route not found: ${req.method} ${req.url}`;
  log(errorMsg, 'WARN');
  res.status(404).json({ success: false, error: 'Not Found' });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  const errorMsg = `Server error: ${err.message}`;
  log(errorMsg, 'ERROR');
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// Conditional startup: HTTPS or HTTP based on USE_HTTPS environment variable
if (process.env.USE_HTTPS === 'true') {
  // Import HTTPS module
  const https = require('https');
  // Synchronously read SSL certificate and key files
  try {
    const cert = fsSync.readFileSync(path.join(__dirname, 'server.cert'));
    const key = fsSync.readFileSync(path.join(__dirname, 'server.key'));
    const options = { key, cert };

    https.createServer(options, app).listen(port, '0.0.0.0', () => {
      log(`HTTPS Server running at https://0.0.0.0:${port}`);
    });
  } catch (error) {
    log(`Failed to start HTTPS server: ${error.message}`, 'ERROR');
    process.exit(1);
  }
} else {
  app.listen(port, '0.0.0.0', () => {
    log(`Server running at http://0.0.0.0:${port}`);
  });
}
// server.js
'use strict';

const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ignore = require('ignore');
const cors = require('cors');
const dotenv = require('dotenv');
const app = express();
const port = process.env.PORT || 3000;

// Load environment variables from .env file
dotenv.config();

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

// Middleware
app.use(express.json());
app.use(cors());

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
    await fs.access(dirPath, fs.constants.R_OK); // Check read access
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

    const tree = await buildDirectoryTree(dirPath, filteredFiles, ig);
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

        const subTree = await buildDirectoryTree(fullPath, filteredSubDirents, ig);
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

    https.createServer(options, app).listen(port, () => {
      log(`HTTPS Server running at https://localhost:${port}`);
    });
  } catch (error) {
    log(`Failed to start HTTPS server: ${error.message}`, 'ERROR');
    process.exit(1);
  }
} else {
  app.listen(port, () => {
    log(`Server running at http://localhost:${port}`);
  });
}
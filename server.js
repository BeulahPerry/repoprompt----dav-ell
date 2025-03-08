// server.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const ignore = require('ignore');
const app = express();
const port = 3000;

app.use(express.static('public'));
app.use(express.json());

// Utility function for logging
const log = (message, level = 'INFO') => {
  console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
};

// API to get directory contents
app.get('/api/directory', async (req, res) => {
  const dirPath = req.query.path || '/Users/davell/Documents/github/repoprompt';
  
  try {
    // Validate directory exists
    await fs.access(dirPath);
    log(`Processing directory: ${dirPath}`);

    // Check for .gitignore file
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
  const filePath = req.query.path;
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

app.listen(port, () => {
  log(`Server running at http://localhost:${port}`);
});
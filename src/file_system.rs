use crate::models::TreeNode;
use crate::utils::natural_compare;
use ignore::gitignore::Gitignore;
use log::debug;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn validate_path(requested_path: &str) -> Result<PathBuf, String> {
    let base_path = PathBuf::from(requested_path);
    if !base_path.exists() {
        return Err(format!("Path does not exist: {}", requested_path));
    }
    let resolved_path = base_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?;

    // For security, you might want to restrict access to certain directories.
    // This example allows access to any valid path on the system.
    Ok(resolved_path)
}

pub fn build_tree(path: &Path, ig: &Gitignore) -> Result<HashMap<String, TreeNode>, String> {
    debug!("Building file tree for directory: {}", path.display());
    let mut tree = HashMap::new();
    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut dirents = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        if ig.matched(&entry.path(), entry.path().is_dir()).is_ignore() {
            continue;
        }
        dirents.push(entry);
    }

    dirents.sort_by(|a, b| {
        let a_is_dir = a.file_type().map_or(false, |ft| ft.is_dir());
        let b_is_dir = b.file_type().map_or(false, |ft| ft.is_dir());
        if a_is_dir != b_is_dir {
            return b_is_dir.cmp(&a_is_dir);
        }
        natural_compare(&a.file_name().to_string_lossy(), &b.file_name().to_string_lossy())
    });

    for entry in dirents {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            let children = build_tree(&path, ig)?;
            let node = TreeNode {
                node_type: "folder".to_string(),
                path: path.to_string_lossy().to_string(),
                children: Some(children),
            };
            tree.insert(name, node);
        } else {
            let node = TreeNode {
                node_type: "file".to_string(),
                path: path.to_string_lossy().to_string(),
                children: None,
            };
            tree.insert(name, node);
        }
    }
    Ok(tree)
}
use crate::models::TreeNode;
use log::{debug, info, warn};
use path_clean::PathClean;
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Parser, Query, QueryCursor};

// Type alias for the dependency graph for clarity
pub type DependencyGraph = HashMap<String, Vec<String>>;

/// Analyzes the file tree to build a dependency graph for supported languages.
pub fn analyze_dependencies(
    root_path: &Path,
    tree: &HashMap<String, TreeNode>,
) -> Result<DependencyGraph, Box<dyn Error>> {
    info!("Starting dependency analysis for '{}'...", root_path.display());
    let start_time = Instant::now();
    let mut dependency_graph = HashMap::new();
    let mut files_to_scan = Vec::new();

    fn collect_files(node: &HashMap<String, TreeNode>, files: &mut Vec<String>) {
        for (_, child) in node {
            if child.node_type == "file" {
                files.push(child.path.clone());
            }
            if let Some(children) = &child.children {
                collect_files(children, files);
            }
        }
    }
    collect_files(tree, &mut files_to_scan);

    // Analyze each supported language
    analyze_javascript_typescript(root_path, &files_to_scan, &mut dependency_graph);
    analyze_python(root_path, &files_to_scan, &mut dependency_graph);
    analyze_rust(root_path, &files_to_scan, &mut dependency_graph);
    analyze_cpp(root_path, &files_to_scan, &mut dependency_graph);

    let duration = start_time.elapsed();
    info!(
        "Dependency analysis for '{}' finished in {:.2?}. Found dependencies for {} files.",
        root_path.display(),
        duration,
        dependency_graph.len()
    );
    Ok(dependency_graph)
}

/// Expands dependencies for Python's `__init__.py` files.
/// If a file depends on an `__init__.py`, it implicitly depends on everything
/// that `__init__.py` file imports, transitively.
pub fn expand_init_dependencies(dependency_graph: &DependencyGraph) -> DependencyGraph {
    let mut expanded_graph = HashMap::new();

    for (file, direct_deps) in dependency_graph {
        let mut final_deps: HashSet<String> = direct_deps.iter().cloned().collect();

        for dep in direct_deps {
            if Path::new(dep).file_name().and_then(|s| s.to_str()) == Some("__init__.py") {
                let mut visited = HashSet::new();
                collect_transitive_init_deps(dep, dependency_graph, &mut final_deps, &mut visited);
            }
        }

        let mut sorted_deps: Vec<String> = final_deps.into_iter().collect();
        sorted_deps.sort_by(|a, b| natord::compare(a, b));
        expanded_graph.insert(file.clone(), sorted_deps);
    }

    expanded_graph
}

fn collect_transitive_init_deps(
    init_file: &str,
    original_graph: &DependencyGraph,
    final_deps: &mut HashSet<String>,
    visited: &mut HashSet<String>,
) {
    if !visited.insert(init_file.to_string()) {
        return; // Cycle detected or already visited
    }

    if let Some(init_direct_deps) = original_graph.get(init_file) {
        for dep in init_direct_deps {
            final_deps.insert(dep.clone());
            if Path::new(dep).file_name().and_then(|s| s.to_str()) == Some("__init__.py") {
                collect_transitive_init_deps(dep, original_graph, final_deps, visited);
            }
        }
    }
}

/// Helper function to resolve a relative import/module path to a file path.
/// Tries appending possible suffixes and checks if the resolved path exists within the root.
fn resolve_relative_path(
    parent_dir: &Path,
    import_str: &str,
    root_path: &Path,
    suffixes: &[&str],
) -> Option<String> {
    for suffix in suffixes {
        let candidate = parent_dir.join(format!("{}{}", import_str, suffix)).clean();
        if candidate.is_file() && candidate.starts_with(root_path) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// Analyzes JavaScript and TypeScript files for dependencies.
fn analyze_javascript_typescript(
    root_path: &Path,
    files_to_scan: &[String],
    dependency_graph: &mut DependencyGraph,
) {
    let language: Language = tree_sitter_javascript::LANGUAGE.into();
    let mut parser = Parser::new();
    if let Err(e) = parser.set_language(&language) {
        warn!("Failed to set language for JavaScript: {}. JS/TS dependency analysis will be skipped.", e);
        return;
    }

    let query_src = r#"
(import_statement source: (string (string_fragment) @path))
(call_expression
  function: (identifier) @_fn
  arguments: (arguments (string (string_fragment) @path))
  (#eq? @_fn "require"))
"#;
    let query = match Query::new(&language, query_src) {
        Ok(q) => q,
        Err(e) => {
            warn!("Failed to compile JavaScript tree-sitter query: {}. JS/TS dependency analysis will be skipped.", e);
            return;
        }
    };

    let js_like_files: Vec<_> = files_to_scan
        .iter()
        .filter(|file_path_str| {
            let file_path = PathBuf::from(file_path_str);
            file_path.extension().map_or(false, |e| {
                e == "js" || e == "jsx" || e == "ts" || e == "tsx"
            })
        })
        .collect();

    debug!("Found {} JavaScript/TypeScript files to scan for dependencies.", js_like_files.len());

    for file_path_str in js_like_files {
        let file_path = PathBuf::from(file_path_str);
        
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        let tree = match parser.parse(content.as_bytes(), None) {
            Some(t) => t,
            None => continue,
        };

        let mut cursor = QueryCursor::new();
        let mut matches_iter = cursor.matches(&query, tree.root_node(), content.as_bytes());
        let mut dependencies = Vec::new();

        while let Some(mat) = matches_iter.next() {
            for cap in mat.captures {
                if query.capture_names()[cap.index as usize] != "path" {
                    continue;
                }

                let path_node = cap.node;
                let import_path_str = &content[path_node.byte_range()];
                let clean_import = import_path_str.trim_matches('"').trim_matches('\'');
                debug!("Found JS/TS import '{}' in '{}'", clean_import, file_path.display());

                if let Some(parent_dir) = file_path.parent() {
                    let possible_exts = [
                        "", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx",
                        "/index.ts", "/index.tsx",
                    ];
                    if let Some(resolved) = resolve_relative_path(parent_dir, clean_import, root_path, &possible_exts) {
                        dependencies.push(resolved);
                    }
                }
            }
        }

        if !dependencies.is_empty() {
            dependency_graph
                .entry(file_path_str.clone())
                .or_default()
                .extend(dependencies);
        }
    }
}

fn process_python_module(
    module_str: &str,
    file_path_str: &String,
    file_path: &Path,
    root_path: &Path,
    dependency_graph: &mut DependencyGraph,
) {
    let clean_import = if module_str.starts_with('.') {
        // Relative import like 'from .foo import ...' or 'from ..foo.bar import ...'
        let num_dots = module_str.find(|c| c != '.').unwrap_or(module_str.len());
        let mut path_prefix = String::new();
        if num_dots > 1 {
            path_prefix.push_str(&"../".repeat(num_dots - 1));
        }
        let module_part = &module_str[num_dots..];
        format!("{}{}", path_prefix, module_part.replace('.', "/"))
    } else {
        // Absolute import
        module_str.replace('.', "/")
    };

    debug!("Found Python import '{}', processed to '{}' in '{}'", module_str, clean_import, file_path.display());
    if let Some(parent_dir) = file_path.parent() {
        let possible_exts = [".py", "/__init__.py"];
        if let Some(resolved) = resolve_relative_path(parent_dir, &clean_import, root_path, &possible_exts) {
            dependency_graph
                .entry(file_path_str.clone())
                .or_insert_with(Vec::new)
                .push(resolved);
        }
    }
}

/// Analyzes Python files for dependencies.
fn analyze_python(
    root_path: &Path,
    files_to_scan: &[String],
    dependency_graph: &mut DependencyGraph,
) {
    let language: Language = tree_sitter_python::LANGUAGE.into();
    let mut parser = Parser::new();
    if let Err(e) = parser.set_language(&language) {
        warn!("Failed to set language for Python: {}. Python dependency analysis will be skipped.", e);
        return;
    }

    let query_src = r#"
; Pattern 0: import foo
(import_statement (dotted_name) @module)
; Pattern 1: from foo.bar import ... and from .foo import ...
(import_from_statement
  module_name: [
    (dotted_name) @module
    (relative_import (dotted_name) . ) @module
  ]
)
; Pattern 2: from . import foo
(import_from_statement
  module_name: (relative_import) @dots
  name: [
    (dotted_name) @name
    (aliased_import name: (dotted_name) @name)
  ]
  (#match? @dots "^\.+$")
)
"#;
    let query = match Query::new(&language, query_src) {
        Ok(q) => q,
        Err(e) => {
            warn!("Failed to compile Python tree-sitter query: {}. Python dependency analysis will be skipped.", e);
            return;
        }
    };

    let py_files: Vec<_> = files_to_scan
        .iter()
        .filter(|file_path_str| {
            PathBuf::from(file_path_str)
                .extension()
                .map_or(false, |e| e == "py")
        })
        .collect();
    
    debug!("Found {} Python files to scan for dependencies.", py_files.len());

    for file_path_str in py_files {
        let file_path = PathBuf::from(file_path_str);
        
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        let tree = match parser.parse(content.as_bytes(), None) {
            Some(t) => t,
            None => continue,
        };

        let mut cursor = QueryCursor::new();
        let mut matches_iter = cursor.matches(&query, tree.root_node(), content.as_bytes());

        while let Some(mat) = matches_iter.next() {
            match mat.pattern_index {
                0 | 1 => { // import a.b, from a.b import c, from .a import c
                    for cap in mat.captures {
                        if query.capture_names()[cap.index as usize] == "module" {
                            let module_str = &content[cap.node.byte_range()];
                            process_python_module(module_str, file_path_str, &file_path, root_path, dependency_graph);
                        }
                    }
                },
                2 => { // from . import a, from .. import b
                    let mut dots_opt = None;
                    let mut names = Vec::new();
                    for cap in mat.captures {
                        let cap_name = query.capture_names()[cap.index as usize];
                        let text = &content[cap.node.byte_range()];
                        match cap_name {
                            "dots" => dots_opt = Some(text),
                            "name" => names.push(text),
                            _ => {}
                        }
                    }
                    if let Some(dots) = dots_opt {
                        for name in names {
                            let combined_module = format!("{}{}", dots, name);
                            process_python_module(&combined_module, file_path_str, &file_path, root_path, dependency_graph);
                        }
                    }
                },
                _ => {} // Unhandled pattern
            }
        }
    }
}


/// Analyzes Rust files for dependencies.
fn analyze_rust(
    root_path: &Path,
    files_to_scan: &[String],
    dependency_graph: &mut DependencyGraph,
) {
    let language: Language = tree_sitter_rust::LANGUAGE.into();
    let mut parser = Parser::new();
    if let Err(e) = parser.set_language(&language) {
        warn!("Failed to set language for Rust: {}. Rust dependency analysis will be skipped.", e);
        return;
    }
    let query_src = r#"
(mod_item name: (identifier) @module)
(use_declaration argument: [ (identifier) @module (scoped_identifier) @module ])
"#;
    let query = match Query::new(&language, query_src) {
        Ok(q) => q,
        Err(e) => {
            warn!("Failed to compile Rust tree-sitter query: {}. Rust dependency analysis will be skipped.", e);
            return;
        }
    };
    let rs_files: Vec<_> = files_to_scan
        .iter()
        .filter(|file_path_str| PathBuf::from(file_path_str).extension().map_or(false, |e| e == "rs"))
        .collect();

    debug!("Found {} Rust files to scan for dependencies.", rs_files.len());
    
    for file_path_str in rs_files {
        let file_path = PathBuf::from(file_path_str);
        
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        let tree = match parser.parse(content.as_bytes(), None) {
            Some(t) => t,
            None => continue,
        };

        let mut cursor = QueryCursor::new();
        let mut matches_iter = cursor.matches(&query, tree.root_node(), content.as_bytes());
        let mut dependencies = Vec::new();

        while let Some(mat) = matches_iter.next() {
            for cap in mat.captures {
                if query.capture_names()[cap.index as usize] != "module" {
                    continue;
                }
                
                let path_node = cap.node;
                let module_str = &content[path_node.byte_range()];
                let mut clean_import = if let Some(stripped) = module_str.strip_prefix("self::") {
                    stripped.to_string()
                } else if let Some(stripped) = module_str.strip_prefix("super::") {
                    format!("../{}", stripped)
                } else {
                    module_str.to_string()
                };
                clean_import = clean_import.replace("::", "/");

                debug!("Found Rust module/use '{}', processed to '{}' in '{}'", module_str, clean_import, file_path.display());

                if let Some(parent_dir) = file_path.parent() {
                    let possible_exts = [".rs", "/mod.rs"];
                    if let Some(resolved) = resolve_relative_path(parent_dir, &clean_import, root_path, &possible_exts) {
                        dependencies.push(resolved);
                    }
                }
            }
        }

        if !dependencies.is_empty() {
            dependency_graph
                .entry(file_path_str.clone())
                .or_default()
                .extend(dependencies);
        }
    }
}

/// Analyzes C/C++ files for dependencies.
fn analyze_cpp(
    root_path: &Path,
    files_to_scan: &[String],
    dependency_graph: &mut DependencyGraph,
) {
    let language: Language = tree_sitter_cpp::LANGUAGE.into();
    let mut parser = Parser::new();
    if let Err(e) = parser.set_language(&language) {
        warn!("Failed to set language for C++: {}. C++ dependency analysis will be skipped.", e);
        return;
    }
    let query_src = r#"(preproc_include path: (string_literal (string_content) @header))"#;
    let query = match Query::new(&language, query_src) {
        Ok(q) => q,
        Err(e) => {
            warn!("Failed to compile C++ tree-sitter query: {}. C++ dependency analysis will be skipped.", e);
            return;
        }
    };
    let cpp_files: Vec<_> = files_to_scan
        .iter()
        .filter(|file_path_str| {
            let path_buf = PathBuf::from(file_path_str);
            let ext = path_buf.extension().and_then(|s| s.to_str());
            matches!(ext, Some("cpp" | "c" | "h" | "hpp" | "hxx"))
        })
        .collect();

    debug!("Found {} C++ files to scan for dependencies.", cpp_files.len());
    
    for file_path_str in cpp_files {
        let file_path = PathBuf::from(file_path_str);
        
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        let tree = match parser.parse(content.as_bytes(), None) {
            Some(t) => t,
            None => continue,
        };

        let mut cursor = QueryCursor::new();
        let mut matches_iter = cursor.matches(&query, tree.root_node(), content.as_bytes());
        let mut dependencies = Vec::new();

        while let Some(mat) = matches_iter.next() {
            for cap in mat.captures {
                if query.capture_names()[cap.index as usize] != "header" {
                    continue;
                }

                let path_node = cap.node;
                let header_str = &content[path_node.byte_range()];
                let clean_import = header_str.trim_matches('"').trim_matches('\'');
                debug!("Found C++ include '{}' in '{}'", clean_import, file_path.display());
                
                if let Some(parent_dir) = file_path.parent() {
                    let possible_exts = ["", ".h", ".hpp", ".hxx"];
                    if let Some(resolved) = resolve_relative_path(parent_dir, clean_import, root_path, &possible_exts) {
                        dependencies.push(resolved);
                    }
                }
            }
        }

        if !dependencies.is_empty() {
            dependency_graph
                .entry(file_path_str.clone())
                .or_default()
                .extend(dependencies);
        }
    }
}
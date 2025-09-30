// Simple text search functionality for the file explorer.

/**
 * Performs a simple case-insensitive substring search.
 * @param {string} searchTerm - The search term (case insensitive).
 * @param {string} target - The string to search in.
 * @returns {number} - The index where the match starts, or -1 if no match.
 */
function simpleMatch(searchTerm, target) {
    if (!searchTerm) return -1;
    return target.toLowerCase().indexOf(searchTerm.toLowerCase());
}

/**
 * Recursively searches through a file tree and returns matching files with their paths.
 * @param {Object} tree - The file tree object.
 * @param {string} searchTerm - The search term.
 * @param {string} parentPath - The parent path (for building full paths).
 * @returns {Array} - Array of { path, name } for matching files.
 */
function searchInTree(tree, searchTerm, parentPath = "") {
    const results = [];

    for (const [name, node] of Object.entries(tree)) {
        const nodePath = node.path || (parentPath ? `${parentPath}/${name}` : name);

        if (node.type === "file") {
            const matchIndex = simpleMatch(searchTerm, name);
            if (matchIndex !== -1) {
                results.push({
                    path: nodePath,
                    name: name
                });
            }
        } else if (node.type === "folder" && node.children) {
            // Recursively search in folders
            const childResults = searchInTree(node.children, searchTerm, nodePath);
            results.push(...childResults);
        }
    }

    return results;
}

/**
 * Filters a tree to only include files that match the search term and their parent folders.
 * @param {Object} tree - The file tree object.
 * @param {Set<string>} matchingPaths - Set of file paths that match the search.
 * @param {string} parentPath - The parent path.
 * @returns {Object|null} - Filtered tree or null if no matches in this branch.
 */
function filterTreeByPaths(tree, matchingPaths, parentPath = "") {
    const filteredTree = {};
    let hasMatches = false;

    for (const [name, node] of Object.entries(tree)) {
        const nodePath = node.path || (parentPath ? `${parentPath}/${name}` : name);

        if (node.type === "file") {
            if (matchingPaths.has(nodePath)) {
                filteredTree[name] = { ...node };
                hasMatches = true;
            }
        } else if (node.type === "folder" && node.children) {
            const filteredChildren = filterTreeByPaths(node.children, matchingPaths, nodePath);
            if (filteredChildren && Object.keys(filteredChildren).length > 0) {
                filteredTree[name] = {
                    ...node,
                    children: filteredChildren
                };
                hasMatches = true;
            }
        }
    }

    return hasMatches ? filteredTree : null;
}

/**
 * Searches all directories for files matching the search term.
 * @param {Array} directories - Array of directory objects from state.
 * @param {string} searchTerm - The search term.
 * @returns {Map} - Map of dirId to filtered tree.
 */
export function searchFileTree(directories, searchTerm) {
    if (!searchTerm || searchTerm.trim() === "") {
        return null; // No search term, return null to indicate no filtering
    }

    const filteredTrees = new Map();

    for (const dir of directories) {
        if (!dir.tree || dir.error) continue;

        // Search for matching files in this directory
        const matches = searchInTree(dir.tree, searchTerm);

        if (matches.length > 0) {
            // Create a set of matching file paths for efficient lookup
            const matchingPaths = new Set(matches.map(m => m.path));

            // Filter the tree to only include matching files and their parent folders
            const filteredTree = filterTreeByPaths(dir.tree, matchingPaths);

            if (filteredTree) {
                filteredTrees.set(dir.id, filteredTree);
            }
        }
    }

    return filteredTrees;
}

/**
 * Highlights the matching substring in a filename.
 * @param {string} text - The text to highlight.
 * @param {string} searchTerm - The search term.
 * @returns {string} - HTML string with highlighted matches.
 */
export function highlightMatches(text, searchTerm) {
    if (!searchTerm || searchTerm.trim() === "") {
        return text;
    }

    const matchIndex = simpleMatch(searchTerm, text);
    if (matchIndex === -1) {
        return text;
    }

    // Highlight the entire matching substring
    const before = text.substring(0, matchIndex);
    const match = text.substring(matchIndex, matchIndex + searchTerm.length);
    const after = text.substring(matchIndex + searchTerm.length);

    return `${before}<span class="search-highlight">${match}</span>${after}`;
}



// Manages the dependency graph visualization using force-graph.

import { state } from './state.js';
import { getSelectedPaths } from './fileSelectionManager.js';

let Graph = null;
let baseGraphData = {
  nodes: new Map(), // All nodes from dependency analysis. Key: id, Value: {id, name}
  links: []         // All links from dependency analysis
};

/**
 * Initializes the force-directed graph viewer.
 */
export function initDependencyGraph() {
  const graphElement = document.getElementById('graph');
  if (!graphElement) return;

  Graph = ForceGraph()(graphElement)
    .nodeId('id')
    .nodeLabel('id') // Keep tooltip as the full path
    .linkSource('source')
    .linkTarget('target')
    .backgroundColor('rgba(0,0,0,0)') // Transparent background
    .linkColor(link => link.color || 'rgba(160, 160, 160, 0.5)')
    .linkWidth(1)
    .linkDirectionalArrowLength(3.5)
    .linkDirectionalArrowColor(link => link.color || 'rgba(160, 160, 160, 0.5)')
    .cooldownTicks(200) // Let the graph settle for 200 ticks and then stop the simulation.
    .onNodeHover(node => graphElement.style.cursor = node ? 'pointer' : null)
    .onNodeClick(node => {
        if (!node) return;
        const filePath = node.id;
        // Escape double quotes in path for the query selector.
        const escapedPath = filePath.replace(/"/g, '\\"');
        const fileLi = document.querySelector(`li[data-file="${escapedPath}"]`);
        if (fileLi) {
            const checkbox = fileLi.querySelector('.file-checkbox');
            // Programmatically clicking the checkbox triggers the existing selection logic in fileSelectionManager
            if (checkbox && !checkbox.disabled) {
                checkbox.click();
            }
        }
    })
    .nodeCanvasObject((node, ctx, globalScale) => {
        const label = node.name; // Use the short name for the permanent label
        // Use node.val to determine radius. The values are 5 or 10.
        // Use a scale factor to make them visible but not too big.
        const radius = node.val * 0.4; 

        // Draw the node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = node.color || 'grey';
        ctx.fill();

        // Draw the label text permanently above the node
        // The font size is scaled with the zoom level, but at a square root rate
        // to make it shrink on zoom-out, but not become unreadable too quickly.
        const fontSize = 12 / Math.sqrt(globalScale);
        ctx.font = `${fontSize}px Sans-Serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Match --text-primary from CSS
        ctx.fillStyle = 'rgba(240, 240, 240, 0.9)'; 
        // Position text above the node circle
        ctx.fillText(label, node.x, node.y - radius - 5);
    })
    .onEngineStop(() => {
      state.isGraphFrozen = true;
    });
  
  state.isGraphFrozen = false;
  
  // Adjust physics to create much looser node spacing, especially for tight clusters
  Graph.d3Force('charge').strength(-200); // Strong repulsion to break up tight clusters
  Graph.d3Force('link').distance(80);     // Much longer links to spread connected nodes
  Graph.d3Force('link').strength(0.3);    // Weaker link strength so repulsion can overcome attraction

  // Handle window resize
  window.addEventListener('resize', () => {
    if (Graph) {
      const { width, height } = graphElement.getBoundingClientRect();
      if(width > 0 && height > 0) {
        Graph.width(width).height(height);
      }
    }
  });
}

/**
 * Regenerates the base dependency graph data from the current state.
 */
function regenerateBaseGraphData() {
    const nodesMap = new Map();
    const linksSet = new Set();
    
    // Process dependency graph from all directories
    state.directories.forEach(dir => {
        const graph = dir.dependencyGraph || {};
        for (const file in graph) {
            if (!nodesMap.has(file)) {
                nodesMap.set(file, { id: file, name: file.split('/').pop() });
            }
            graph[file].forEach(dep => {
                if (!nodesMap.has(dep)) {
                    nodesMap.set(dep, { id: dep, name: dep.split('/').pop() });
                }
                const linkKey = `${file} -> ${dep}`;
                linksSet.add(linkKey);
            });
        }
    });
    baseGraphData.nodes = nodesMap;
    baseGraphData.links = Array.from(linksSet).map(linkKey => {
        const [source, target] = linkKey.split(' -> ');
        return { source, target };
    });
}

/**
 * Updates the graph visualization by regenerating the base graph data first.
 * Call this when a full regeneration is needed (e.g., directory change).
 */
export function updateDependencyGraph() {
    if (!Graph) {
        initDependencyGraph();
        if (!Graph) return; // Still couldn't init
    }
    state.isGraphFrozen = false;
    regenerateBaseGraphData();
    updateDependencyGraphSelection(); // Render with new base data
}

/**
 * Updates only the selection-related appearance of the graph (colors, selected-only nodes).
 * Call this when only the file selection changes.
 */
export function updateDependencyGraphSelection() {
    if (!Graph) {
        // If graph is not initialized, we need a full update.
        // This might happen on initial load before any directory is loaded.
        updateDependencyGraph();
        return;
    }
    const graphElement = document.getElementById('graph');

    // Gather selected paths from all directories
    const selectedPaths = new Set();
    state.directories.forEach(dir => {
        getSelectedPaths(dir.selectedTree).forEach(path => {
            selectedPaths.add(path);
        });
    });

    // Determine the set of dependencies from the selected files.
    const dependencyPaths = new Set();
    state.directories.forEach(dir => {
        // Check if the directory has a dependency graph.
        if (!dir.dependencyGraph) return;

        // For each selected file, find its dependencies from the graph.
        selectedPaths.forEach(selectedPath => {
            if (dir.dependencyGraph[selectedPath]) {
                dir.dependencyGraph[selectedPath].forEach(depPath => {
                    // A file is a dependency if it's not also directly selected by the user.
                    if (!selectedPaths.has(depPath)) {
                        dependencyPaths.add(depPath);
                    }
                });
            }
        });
    });


    // To prevent the graph simulation from resetting (which causes nodes to "explode"),
    // we must preserve the object references of nodes that are already present in the graph.
    // The library injects state (like position) directly into these objects.
    // First, get the current nodes from the graph and map them by ID.
    const currentGraphData = Graph.graphData();
    const currentNodeMap = new Map(currentGraphData.nodes.map(node => [node.id, node]));
    
    // Determine the full set of nodes that should be displayed.
    const displayNodeIds = new Set(baseGraphData.nodes.keys());
    selectedPaths.forEach(path => displayNodeIds.add(path));

    const finalNodes = [];
    displayNodeIds.forEach(id => {
        // Check if the node is already in the graph to preserve its object reference and state.
        let node = currentNodeMap.get(id);

        if (!node) {
            // It's a new node, create it from our base data.
            const baseNode = baseGraphData.nodes.get(id);
            node = baseNode ? { ...baseNode } : { id, name: id.split('/').pop() };
        }
        
        // Update visual properties on the (potentially existing) node object.
        node.val = 10; // All nodes are the same, larger size
        if (selectedPaths.has(id)) {
            node.color = '#007aff'; // var(--accent-primary)
        } else if (dependencyPaths.has(id)) {
            node.color = '#34c759'; // var(--dependency-color)
        } else {
            node.color = '#a0a0a0'; // var(--text-secondary)
        }
        finalNodes.push(node);
    });
    
    // Update link colors
    baseGraphData.links.forEach(link => {
        const sourceSelected = selectedPaths.has(link.source);
        const targetSelected = selectedPaths.has(link.target);
        const targetIsDependency = dependencyPaths.has(link.target);

        if (sourceSelected && targetSelected) {
            link.color = '#007aff'; // var(--accent-primary) for links between selected nodes
        } else if (sourceSelected && targetIsDependency) {
            link.color = '#34c759'; // var(--dependency-color) for dependency links
        } else {
            link.color = 'rgba(160, 160, 160, 0.5)'; // default color
        }
    });

    const { width, height } = graphElement.getBoundingClientRect();
    if(width > 0 && height > 0) {
        Graph.width(width).height(height);
    }

    Graph.graphData({ nodes: finalNodes, links: baseGraphData.links });
    if (state.isGraphFrozen) {
        // Try to stop the simulation when graph is frozen
        try {
            Graph.d3AlphaTarget(0).d3Reheat();
        } catch (e) {
            // If that doesn't work, just continue - the graph will settle naturally
            console.log('Could not freeze graph simulation:', e);
        }
    }
}
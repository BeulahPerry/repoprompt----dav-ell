// Manages the dependency graph visualization using D3.
// A force simulation is run headlessly in a Web Worker to generate a static, organic layout without blocking the UI.

import { state } from './state.js';
import { getSelectedPaths } from './fileSelectionManager/selectedTreeBuilder.js';
import { debounce } from './utils.js';

let svg;
let container;
let link;
let node;
let textSel; // For updating font sizes on zoom
let baseGraphData = {
  nodes: new Map(), // All nodes from dependency analysis. Key: id, Value: {id, name}
  links: []         // All links from dependency analysis
};

let graphWorker; // The single web worker for graph layout
let graphFeedbackElement; // To hold the spinner element

/**
 * Shows the loading spinner in the dependency graph header.
 */
function showGraphFeedback() {
    if (!graphFeedbackElement) {
        graphFeedbackElement = document.getElementById('graph-feedback');
    }
    if (graphFeedbackElement) {
        graphFeedbackElement.style.display = 'block';
    }
}

/**
 * Hides the loading spinner in the dependency graph header.
 */
function hideGraphFeedback() {
    if (!graphFeedbackElement) {
        graphFeedbackElement = document.getElementById('graph-feedback');
    }
    if (graphFeedbackElement) {
        graphFeedbackElement.style.display = 'none';
    }
}

/**
 * Initializes the web worker for graph layout calculations.
 */
function initGraphWorker() {
  if (window.Worker) {
    graphWorker = new Worker('js/graphWorker.js');
    graphWorker.onmessage = function(event) {
      const { nodes: layoutNodes } = event.data;
      const nodeMap = new Map(layoutNodes.map(n => [n.id, n]));
      // Reconstruct link objects with references to the new node objects
      const links = baseGraphData.links.map(link => {
        const sourceNode = nodeMap.get(link.source);
        const targetNode = nodeMap.get(link.target);
        if (!sourceNode || !targetNode) return null;
        return { source: sourceNode, target: targetNode };
      }).filter(Boolean);
      renderGraph(layoutNodes, links);
    };
    graphWorker.onerror = function(error) {
      console.error("Graph worker error:", error);
      hideGraphFeedback();
    };
  } else {
    console.error("Web Workers are not supported in this browser.");
  }
}

/**
 * Renders the graph in the DOM using D3.
 * This function contains the D3 DOM manipulation logic.
 * @param {Array} nodes - Nodes with calculated positions from the worker.
 * @param {Array} links - Links with resolved source/target objects.
 */
function renderGraph(nodes, links) {
  if (!svg) return; // Guard against rendering if SVG is not ready
  // Gather selected paths from all directories to determine node/link styles
  const selectedPaths = new Set();
  state.directories.forEach(dir => {
    getSelectedPaths(dir.selectedTree).forEach(path => {
      selectedPaths.add(path);
    });
  });
  // Determine the set of dependencies from the selected files.
  const dependencyPaths = new Set();
  state.directories.forEach(dir => {
    if (!dir.dependencyGraph) return;
    selectedPaths.forEach(selectedPath => {
      if (dir.dependencyGraph[selectedPath]) {
        dir.dependencyGraph[selectedPath].forEach(depPath => {
          if (!selectedPaths.has(depPath)) {
            dependencyPaths.add(depPath);
          }
        });
      }
    });
  });
  // Add visual properties to nodes and links based on current selection state
  nodes.forEach(node => {
    node.val = 10;
    node.selected = selectedPaths.has(node.id);
    node.isDep = dependencyPaths.has(node.id);
    node.color = node.selected ? '#007aff' : node.isDep ? '#34c759' : '#a0a0a0';
  });
  links.forEach(link => {
    const sourceSelected = link.source.selected;
    const targetSelected = link.target.selected;
    const targetIsDependency = link.target.isDep;
    let color = 'rgba(160, 160, 160, 0.5)'; // default
    if (sourceSelected && targetSelected) {
      color = '#007aff';
    } else if (sourceSelected && targetIsDependency) {
      color = '#34c759';
    }
    link.color = color;
  });
  // Update links in DOM
  link = container.selectAll('line')
    .data(links, d => `${d.source.id} -> ${d.target.id}`);
  link.exit().remove();
  link.enter().append('line')
    .attr('stroke-width', 1)
    .merge(link)
    .attr('stroke', d => d.color)
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);
  // Update nodes in DOM
  node = container.selectAll('g.node')
    .data(nodes, d => d.id);
  node.exit().remove();
  const nodeEnter = node.enter()
    .append('g')
    .attr('class', 'node')
    .on('mouseover', function() {
      d3.select(this).style('cursor', 'pointer');
    })
    .on('mouseout', function() {
      d3.select(this).style('cursor', 'default');
    })
    .on('click', function(event, d) {
      if (!d) return;
      const filePath = d.id;
      // Escape double quotes in path for the query selector.
      const escapedPath = filePath.replace(/"/g, '\\"');
      const fileLi = document.querySelector(`li[data-file="${escapedPath}"]`);
      if (fileLi) {
        const checkbox = fileLi.querySelector('.file-checkbox');
        if (checkbox && !checkbox.disabled) {
          checkbox.click();
        }
      }
    });
  // Append circle and text to entering nodes
  const radiusScale = d => d.val * 0.4;
  nodeEnter.append('circle')
    .attr('r', radiusScale);
  nodeEnter.append('text')
    .attr('dy', '0.35em') // Baseline adjustment
    .attr('text-anchor', 'middle')
    .attr('fill', 'rgba(240, 240, 240, 0.9)')
    .attr('font-family', 'Sans-Serif')
    .attr('font-size', '12px'); // Initial size, updated on zoom
  // Merge enter and update selections
  const nodeUpdate = nodeEnter.merge(node);
  // Update positions for all nodes
  nodeUpdate.attr('transform', d => `translate(${d.x}, ${d.y})`);
  // Update circle appearance for all nodes
  nodeUpdate.select('circle')
    .attr('r', radiusScale)
    .attr('fill', d => d.color);
  // Update text for all nodes
  nodeUpdate.select('text')
    .text(d => d.name)
    .attr('y', d => -radiusScale(d) - 5);
  // Re-select all text elements for zoom handling
  textSel = container.selectAll('g.node text');
  hideGraphFeedback();
}

/**
 * Initializes the dependency graph viewer using D3.
 */
export function initDependencyGraph() {
  const graphElement = document.getElementById('graph');
  if (!graphElement) return;

  initGraphWorker(); // Initialize the worker

  // Clear any existing content
  d3.select(graphElement).selectAll('*').remove();

  // Create SVG
  svg = d3.select(graphElement)
    .append('svg')
    .attr('width', graphElement.clientWidth)
    .attr('height', graphElement.clientHeight)
    .style('background-color', 'rgba(0,0,0,0)'); // Transparent background

  // Add zoom behavior
  const zoomBehavior = d3.zoom()
    .on('zoom', zoomed);

  svg.call(zoomBehavior);

  // Container group for the graph (links and nodes)
  container = svg.append('g')
    .attr('class', 'graph-container');

  // Handle container resize with debouncing
  const debouncedResizeUpdate = debounce(() => {
    if (!graphElement) return;
    const width = graphElement.clientWidth;
    const height = graphElement.clientHeight;
    if (width > 0 && height > 0) {
      svg.attr('width', width).attr('height', height);
      // Recalculate layout on resize
      updateDependencyGraphSelection();
    }
  }, 250);

  // Using ResizeObserver is more robust for element resizes than 'window.resize'
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(debouncedResizeUpdate);
    resizeObserver.observe(graphElement);
  } else {
    // Fallback for older browsers
    window.addEventListener('resize', debouncedResizeUpdate);
  }

  // Zoom handler
  function zoomed(event) {
    container.attr('transform', event.transform);
    // Scale font size inversely with zoom level
    const fontSize = 12 / Math.sqrt(event.transform.k);
    if (textSel) {
      textSel.attr('font-size', `${fontSize}px`);
    }
  }
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
  if (!svg) {
    initDependencyGraph();
    if (!svg) return; // Still couldn't init
  }
  regenerateBaseGraphData();

  const graphSection = document.getElementById('dependency-graph-section');
  if (graphSection) {
    if (baseGraphData.links.length === 0) {
      graphSection.style.display = 'none';
    } else {
      graphSection.style.display = 'block';
    }
  }

  updateDependencyGraphSelection(); // Render with new base data
}

/**
 * Updates the graph visualization based on file selections by offloading layout calculation.
 */
export function updateDependencyGraphSelection() {
  if (!svg) {
    updateDependencyGraph();
    return;
  }
  if (!graphWorker) {
    console.error("Graph worker has not been initialized.");
    return;
  }
  const graphElement = document.getElementById('graph');
  const width = graphElement.clientWidth;
  const height = graphElement.clientHeight;
  if (width <= 0 || height <= 0) {
    return; // Cannot draw if element has no size
  }

  showGraphFeedback();

  // Prepare nodes for simulation
  const nodes = Array.from(baseGraphData.nodes.values()).map(n => ({ ...n }));
  nodes.sort((a, b) => a.id.localeCompare(b.id)); // For deterministic layout
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Prepare links for simulation with string IDs
  const linksForWorker = baseGraphData.links.map(link => {
    if (!nodeMap.has(link.source) || !nodeMap.has(link.target)) return null;
    return { source: link.source, target: link.target };
  }).filter(Boolean);

  // Offload the heavy computation to the web worker
  graphWorker.postMessage({
    nodes,
    links: linksForWorker,
    width,
    height,
  });
}
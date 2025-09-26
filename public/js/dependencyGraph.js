// Manages the dependency graph visualization using D3.
// A force simulation is run headlessly for a short period to generate a static, organic layout.

import { state } from './state.js';
import { getSelectedPaths } from './fileSelectionManager.js';

let svg;
let container;
let link;
let node;
let textSel; // For updating font sizes on zoom
let baseGraphData = {
  nodes: new Map(), // All nodes from dependency analysis. Key: id, Value: {id, name}
  links: []         // All links from dependency analysis
};

/**
 * Initializes the dependency graph viewer using D3.
 */
export function initDependencyGraph() {
  const graphElement = document.getElementById('graph');
  if (!graphElement) return;

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

  // Handle window resize
  window.addEventListener('resize', () => {
    if (!graphElement) return;
    const { width, height } = graphElement.getBoundingClientRect();
    if (width > 0 && height > 0) {
      svg.attr('width', width).attr('height', height);
      // Recalculate layout on resize
      updateDependencyGraphSelection();
    }
  });

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
  updateDependencyGraphSelection(); // Render with new base data
}

/**
 * Updates the graph visualization based on file selections and recalculates layout.
 */
export function updateDependencyGraphSelection() {
  if (!svg) {
    updateDependencyGraph();
    return;
  }
  const graphElement = document.getElementById('graph');
  const { width, height } = graphElement.getBoundingClientRect();
  if (width > 0 && height > 0) {
    svg.attr('width', width).attr('height', height);
  } else {
    return; // Cannot draw if element has no size
  }

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

  // Prepare nodes for simulation
  const nodes = Array.from(baseGraphData.nodes.values()).map(n => ({ ...n }));
  nodes.sort((a, b) => a.id.localeCompare(b.id)); // Sort for deterministic initial layout
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Prepare links for simulation with resolved source/target objects
  const links = baseGraphData.links.map(link => {
    const sourceNode = nodeMap.get(link.source);
    const targetNode = nodeMap.get(link.target);
    if (!sourceNode || !targetNode) return null;
    return { source: sourceNode, target: targetNode };
  }).filter(Boolean); // Filter out any null links

  // Create and run the force simulation to calculate node positions
  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(80))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .stop();

  // Run the simulation headlessly for a number of iterations to get a stable layout
  const numTicks = 300;
  for (let i = 0; i < numTicks; ++i) {
    simulation.tick();
  }

  // Now that simulation is complete, add visual properties to nodes and links
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
}
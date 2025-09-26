// This script runs in a separate thread.
// It needs to load external libraries using importScripts.
importScripts('https://d3js.org/d3.v7.min.js');

self.onmessage = function(event) {
    const { nodes, links, width, height } = event.data;

    // d3.forceLink works with node objects, not IDs. We need to resolve them.
    // The `nodes` array is what the simulation will mutate.
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const simulationLinks = links.map(link => ({
        source: nodeMap.get(link.source),
        target: nodeMap.get(link.target)
    })).filter(l => l.source && l.target); // Filter out links with missing nodes

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(simulationLinks).id(d => d.id).distance(80))
        .force("charge", d3.forceManyBody().strength(-120))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .stop();

    const numTicks = 300;
    for (let i = 0; i < numTicks; ++i) {
        simulation.tick();
    }

    // The `nodes` array now has x and y properties.
    self.postMessage({ nodes });
};
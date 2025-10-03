/**
 * Card reordering functionality using drag-and-drop.
 * Allows users to rearrange the cards in the main content area.
 */

let draggedCard = null;
let placeholder = null;
let lastTarget = null;

/**
 * Initializes drag-and-drop functionality for all cards in the content area.
 */
export function initCardReordering() {
  const contentArea = document.querySelector('.content-area');
  if (!contentArea) return;

  const cards = contentArea.querySelectorAll('section');
  
  cards.forEach((card, index) => {
    // Add unique IDs to cards if they don't have them
    if (!card.id) {
      card.id = generateCardId(card);
    }
    
    // Make cards draggable
    card.setAttribute('draggable', 'true');
    card.classList.add('draggable-card');
    
    // Add drag handle indicator
    addDragHandle(card);
    
    // Add drag event listeners
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });

  // Add single dragover listener to content area
  contentArea.addEventListener('dragover', handleDragOver);

  // Restore saved card order
  restoreCardOrder();
}

/**
 * Generates a unique ID for a card based on its content.
 */
function generateCardId(card) {
  const heading = card.querySelector('h2');
  if (heading) {
    return 'card-' + heading.textContent.toLowerCase().replace(/\s+/g, '-');
  }
  return 'card-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Adds a drag handle indicator to a card.
 */
function addDragHandle(card) {
  // Don't add if already exists
  if (card.querySelector('.drag-handle')) return;
  
  const heading = card.querySelector('h2');
  if (!heading) return;
  
  // Create drag handle icon
  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle';
  dragHandle.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="5" r="1"></circle>
      <circle cx="9" cy="12" r="1"></circle>
      <circle cx="9" cy="19" r="1"></circle>
      <circle cx="15" cy="5" r="1"></circle>
      <circle cx="15" cy="12" r="1"></circle>
      <circle cx="15" cy="19" r="1"></circle>
    </svg>
  `;
  dragHandle.title = 'Drag to reorder';
  
  // Insert at the beginning of the card
  card.insertBefore(dragHandle, card.firstChild);
}

/**
 * Creates a placeholder element for showing where the card will be dropped.
 */
function createPlaceholder() {
  const div = document.createElement('div');
  div.className = 'card-placeholder';
  return div;
}

/**
 * Handles the start of a drag operation.
 */
function handleDragStart(e) {
  draggedCard = this;
  this.classList.add('dragging');
  
  // Set drag data
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
  
  // Create placeholder
  placeholder = createPlaceholder();
  placeholder.style.height = this.offsetHeight + 'px';
  
  // Insert placeholder after dragged card
  setTimeout(() => {
    this.style.display = 'none';
    this.parentNode.insertBefore(placeholder, this.nextSibling);
  }, 0);
}

/**
 * Handles drag over event to allow dropping and reorder in real-time.
 */
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  if (!draggedCard || !placeholder) return false;
  
  // Get the element we're currently over
  const target = e.target;
  
  // Only update if we've moved to a different card
  if (target === lastTarget) return false;
  lastTarget = target;
  
  // Find the closest card
  const closestCard = target.closest('.draggable-card');
  
  if (closestCard && closestCard !== draggedCard && closestCard !== placeholder) {
    const rect = closestCard.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    
    // Insert before or after based on mouse position
    if (e.clientY < midpoint) {
      closestCard.parentNode.insertBefore(placeholder, closestCard);
    } else {
      closestCard.parentNode.insertBefore(placeholder, closestCard.nextSibling);
    }
  }
  
  return false;
}

/**
 * Handles the end of a drag operation.
 */
function handleDragEnd(e) {
  this.classList.remove('dragging');
  this.style.display = '';
  
  // Replace placeholder with the actual card
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.insertBefore(this, placeholder);
    placeholder.remove();
  }
  
  placeholder = null;
  draggedCard = null;
  lastTarget = null;
  
  // Save the new order
  saveCardOrder();
}

/**
 * Saves the current card order to localStorage.
 */
function saveCardOrder() {
  const contentArea = document.querySelector('.content-area');
  const cards = Array.from(contentArea.querySelectorAll('section'));
  const order = cards.map(card => card.id);
  localStorage.setItem('cardOrder', JSON.stringify(order));
}

/**
 * Restores the saved card order from localStorage.
 */
function restoreCardOrder() {
  const savedOrder = localStorage.getItem('cardOrder');
  if (!savedOrder) return;
  
  try {
    const order = JSON.parse(savedOrder);
    const contentArea = document.querySelector('.content-area');
    const cards = Array.from(contentArea.querySelectorAll('section'));
    
    // Create a map of card IDs to elements
    const cardMap = new Map();
    cards.forEach(card => {
      cardMap.set(card.id, card);
    });
    
    // Reorder cards based on saved order
    order.forEach((cardId, index) => {
      const card = cardMap.get(cardId);
      if (card) {
        contentArea.appendChild(card);
      }
    });
  } catch (e) {
    console.error('Error restoring card order:', e);
  }
}


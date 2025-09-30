// Handles the core logic for selecting/deselecting files and folders and updating checkbox states.

/**
 * Recursively propagates selection state to the UI of visible (expanded) children.
 * This is the core of the performance optimization, as it avoids manipulating the DOM
 * for children inside collapsed folders.
 * @param {HTMLElement} li - The parent folder `li` element.
 * @param {boolean} select - The selection state to propagate.
 */
export function propagateSelectionToVisibleChildren(li, select) {
  if (li.classList.contains('collapsed')) {
    return; // Stop if folder is collapsed, as its children are not visible.
  }

  const childUl = li.querySelector(':scope > ul');
  if (!childUl) return;

  const childItems = childUl.querySelectorAll(':scope > li');
  childItems.forEach(childLi => {
    if (childLi.hasAttribute('data-file')) {
      const checkbox = childLi.querySelector('.file-checkbox');
      if (checkbox && !checkbox.disabled) {
        checkbox.checked = select;
        childLi.classList.toggle('selected', select);
      }
    } else if (childLi.hasAttribute('data-folder')) {
      const checkbox = childLi.querySelector('.folder-checkbox');
      if (checkbox) {
        checkbox.checked = select;
        checkbox.indeterminate = false;
      }
      // Recurse to handle nested expanded folders
      propagateSelectionToVisibleChildren(childLi, select);
    }
  });
}

/**
 * Updates a folder's checkbox state (checked, indeterminate, unchecked) based on the
 * selection state of its immediate children (files and subfolders).
 * @param {HTMLElement} li - The folder li element to update.
 */
function updateFolderCheckbox(li) {
  const folderCheckbox = li.querySelector(':scope > .folder-header > .folder-checkbox');
  if (!folderCheckbox) return;

  const childUl = li.querySelector(':scope > ul');
  if (!childUl) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
    return;
  }

  const childFileLis = childUl.querySelectorAll(':scope > li[data-file]');
  const childSubfolderLis = childUl.querySelectorAll(':scope > li[data-folder]');

  let allChildrenSelected = true;
  let someChildrenSelected = false;
  let hasSelectableChildren = false;

  childFileLis.forEach(fileLi => {
    const fileCheckbox = fileLi.querySelector('.file-checkbox');
    if (fileCheckbox && !fileCheckbox.disabled) {
      hasSelectableChildren = true;
      if (fileCheckbox.checked) {
        someChildrenSelected = true;
      } else {
        allChildrenSelected = false;
      }
    }
  });

  childSubfolderLis.forEach(subLi => {
    hasSelectableChildren = true;
    const subCheckbox = subLi.querySelector(':scope > .folder-header > .folder-checkbox');
    if (subCheckbox) {
      if (subCheckbox.checked) {
        someChildrenSelected = true;
      } else if (subCheckbox.indeterminate) {
        someChildrenSelected = true;
        allChildrenSelected = false;
      } else {
        allChildrenSelected = false;
      }
    }
  });

  if (!hasSelectableChildren) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
  } else if (allChildrenSelected) {
    folderCheckbox.checked = true;
    folderCheckbox.indeterminate = false;
  } else if (someChildrenSelected) {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = true;
  } else {
    folderCheckbox.checked = false;
    folderCheckbox.indeterminate = false;
  }
}

/**
 * Updates the checkbox states (checked, indeterminate) of all parent folders
 * up the DOM tree until the main file-list or another directory root.
 * @param {HTMLElement} li - The starting li element (file or folder).
 */
function updateParentFolders(li) {
  let currentLi = li.parentElement.closest('li[data-folder]');
  while (currentLi) {
    updateFolderCheckbox(currentLi);
    currentLi = currentLi.parentElement.closest('li[data-folder]');
  }
}


/**
 * Recursively selects or deselects all children (files and folders) of a folder LI element.
 * Updates checkbox states and 'selected' class for files. This is optimized to only
 * update visible children to prevent UI stutter with large, collapsed directories.
 * @param {HTMLElement} li - The folder li element.
 * @param {boolean} select - Whether to select or deselect.
 */
export function toggleFolderSelection(li, select) {
  console.log(`Toggling folder ${li.getAttribute('data-folder')} to ${select}`);

  // Update the state of the folder that was clicked. This is fast.
  const checkbox = li.querySelector('.folder-checkbox');
  if (checkbox) {
    checkbox.checked = select;
    checkbox.indeterminate = false;
  }

  // Visually update any children that are currently visible.
  // This is the main performance optimization: collapsed subtrees are not touched.
  propagateSelectionToVisibleChildren(li, select);

  // Update the state of parent folders up the tree.
  updateParentFolders(li);
}

/**
 * Toggles selection of a single file.
 * @param {HTMLElement} li - The file li element.
 * @param {boolean} select - Whether to select or deselect.
 */
export function toggleFileSelection(li, select) {
  console.log(`Toggling file ${li.getAttribute('data-file')} to ${select}`);
  const checkbox = li.querySelector('.file-checkbox');
  if (checkbox && !checkbox.disabled) {
    checkbox.checked = select;
    li.classList.toggle('selected', select);
    updateParentFolders(li);
  }
}

/**
 * Updates all folder checkboxes starting from the top level directories
 * down the hierarchy based on their children's states.
 */
export function updateAllFolderCheckboxes() {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;
  const allFolderLis = fileList.querySelectorAll('li[data-folder]');
  Array.from(allFolderLis).reverse().forEach(folderLi => {
    updateFolderCheckbox(folderLi);
  });
}
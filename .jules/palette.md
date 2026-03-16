## 2024-03-11 - Dynamic ARIA State and Focus Management
**Learning:** In a vanilla JS component setup (like BlankDrive's Web UI), dynamically managing state-based ARIA attributes (`aria-busy` for loading states, `aria-current` for active list items) and explicitly handling focus shifts for modals are critical for maintaining accessibility without a reactive framework.
**Action:** Ensure that utility functions (like `busy()`) and DOM builders (like `renderEntries()`) intrinsically bind semantic ARIA attributes to visual state changes, and always shift focus into and out of modals explicitly.

## 2024-11-20 - Accessible Truncated Text & Disabled Elements
**Learning:** Text elements that are visually truncated (via CSS `text-overflow: ellipsis`) are inaccessible to users relying on visual inspection if they can't see the full text, and disjointed text fragments inside interactive elements (like buttons) create a poor screen reader experience. Also, users need context when form elements are disabled.
**Action:** Always add a `title` attribute with the full text to visually truncated elements. Provide a consolidated string via `aria-label` on parent interactive elements that contain multiple text nodes. Additionally, dynamically set `title` attributes on disabled elements to explain why they are disabled (e.g. "Vault is locked.").

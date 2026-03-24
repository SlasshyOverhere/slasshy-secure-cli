## 2024-03-11 - Dynamic ARIA State and Focus Management
**Learning:** In a vanilla JS component setup (like BlankDrive's Web UI), dynamically managing state-based ARIA attributes (`aria-busy` for loading states, `aria-current` for active list items) and explicitly handling focus shifts for modals are critical for maintaining accessibility without a reactive framework.
**Action:** Ensure that utility functions (like `busy()`) and DOM builders (like `renderEntries()`) intrinsically bind semantic ARIA attributes to visual state changes, and always shift focus into and out of modals explicitly.

## 2024-03-13 - Visual clarity for disabled form inputs
**Learning:** In the Web UI, disabling an entire form programmatically via JS logic when the vault is locked leaves inputs structurally inactive but visually identical to their active counterparts. This forces users to "test" inputs (by clicking or tabbing) to confirm their state, which creates friction and confusion.
**Action:** Always provide explicit disabled CSS rules (`opacity: 0.5`, `cursor: not-allowed`, adjusted backgrounds) for form controls (`input:disabled`, `textarea:disabled`, `select:disabled`) to ensure the interactive state matches the visual state.

## 2024-03-15 - Improving Accessibility for Disabled Elements and Screen Reader Output
**Learning:** In dynamically constructed interactive elements containing multiple text nodes (like `.entry-item` buttons in BlankDrive's Web UI), screen readers often announce disjointed text. Additionally, when elements are disabled or truncated with CSS (`text-overflow: ellipsis`), users lack context for why they are disabled or what the full text is.
**Action:** Provide a consolidated string via `aria-label` on parent elements to prevent screen readers from announcing fragmented text. Always supply a `title` attribute for truncated text or disabled interactive elements to explain their state and improve user experience.

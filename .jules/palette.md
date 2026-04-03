## 2024-03-11 - Dynamic ARIA State and Focus Management
**Learning:** In a vanilla JS component setup (like BlankDrive's Web UI), dynamically managing state-based ARIA attributes (`aria-busy` for loading states, `aria-current` for active list items) and explicitly handling focus shifts for modals are critical for maintaining accessibility without a reactive framework.
**Action:** Ensure that utility functions (like `busy()`) and DOM builders (like `renderEntries()`) intrinsically bind semantic ARIA attributes to visual state changes, and always shift focus into and out of modals explicitly.

## 2024-03-13 - Visual clarity for disabled form inputs
**Learning:** In the Web UI, disabling an entire form programmatically via JS logic when the vault is locked leaves inputs structurally inactive but visually identical to their active counterparts. This forces users to "test" inputs (by clicking or tabbing) to confirm their state, which creates friction and confusion.
**Action:** Always provide explicit disabled CSS rules (`opacity: 0.5`, `cursor: not-allowed`, adjusted backgrounds) for form controls (`input:disabled`, `textarea:disabled`, `select:disabled`) to ensure the interactive state matches the visual state.

## 2024-03-15 - Improving Accessibility for Disabled Elements and Screen Reader Output
**Learning:** In dynamically constructed interactive elements containing multiple text nodes (like `.entry-item` buttons in BlankDrive's Web UI), screen readers often announce disjointed text. Additionally, when elements are disabled or truncated with CSS (`text-overflow: ellipsis`), users lack context for why they are disabled or what the full text is.
**Action:** Provide a consolidated string via `aria-label` on parent elements to prevent screen readers from announcing fragmented text. Always supply a `title` attribute for truncated text or disabled interactive elements to explain their state and improve user experience.

## 2024-03-16 - Safe Global Keyboard Shortcuts
**Learning:** Adding single-key global keyboard shortcuts (like `/` to focus search) without context checks can unintentionally intercept normal typing in inputs, textareas, or selects. Additionally, small input fields with shortcut hints in the placeholder may truncate text visually.
**Action:** Always verify `document.activeElement?.tagName` to safely ignore keystrokes when the user is already typing in an `INPUT`, `TEXTAREA`, or `SELECT`, and call `ev.preventDefault()` before focusing the target element to prevent the shortcut character from being entered. Use a succinct placeholder text (like `Search… (/)`) to avoid truncation and update `aria-label` to announce the shortcut for screen readers.

## 2024-03-18 - Empty State Feedback & Contextual Clarity
**Learning:** Adding subtle feedback indicators (like inline "Copied!" text that reverts after a delay) and clearly demarcating empty states (using an `empty-state` CSS class for empty and locked screens) drastically reduces uncertainty. Similarly, marking required fields with `*` and defining standard ARIA labels and titles for context-less icons (like a video close button) are minimal enhancements that compound into a significant accessibility and usability improvement without fundamentally changing the design.
**Action:** When working on UI template files, look for implicit states (like locked, empty, or async completion) and verify if the design system provides classes (like `empty-state`) that should be explicitly applied. Additionally, always look for icon-only buttons or required inputs that lack contextual cues (`title`, `aria-label`, or standard placeholders).

## 2024-03-21 - Escape Key to Clear Search Context
**Learning:** Implementing an `Escape` key listener to clear input fields like search boxes drastically improves keyboard navigability, but the interaction must comprehensively handle clearing the value, blurring the focus, and resetting the underlying data model view.
**Action:** When adding `Escape` shortcut interactions to inputs, always ensure the event is captured specifically on that input via `keydown`, prevents default behavior, unfocuses the element via `blur()`, and explicitly triggers any necessary state refreshes (e.g., `refreshEntries()`).

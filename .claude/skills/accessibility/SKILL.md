---
name: accessibility
description: "Use when implementing or reviewing accessible UI components, WCAG compliance, screen reader support, keyboard navigation, or color contrast. Covers ARIA patterns, focus management, and inclusive design."
---

# Accessibility Skill

## Standards

Target WCAG 2.1 AA compliance minimum.

## Key Principles

1. **Perceivable** - All content must be perceivable by all users
2. **Operable** - All functionality must be operable via keyboard
3. **Understandable** - Information and UI must be understandable
4. **Robust** - Content must be robust enough for assistive technologies

## Keyboard Navigation

- All interactive elements must be focusable
- Focus order must be logical and predictable
- Visible focus indicators on all focusable elements
- Escape key closes modals and dropdowns
- Tab key moves between interactive elements

## Screen Readers

- Use semantic HTML elements (`<button>`, `<nav>`, `<main>`, etc.)
- Add `aria-label` or `aria-labelledby` where semantics are insufficient
- Use `aria-live` for dynamic content updates
- Add `alt` text to all meaningful images
- Use `role` attributes only when semantic HTML isn't available

## Forms

- Associate labels with inputs using `htmlFor`/`id`
- Show error messages adjacent to the relevant input
- Use `aria-describedby` for error messages
- Validate inputs on blur, not just on submit
- Provide clear instructions before complex inputs

## Color and Contrast

- Minimum 4.5:1 contrast ratio for normal text
- Minimum 3:1 contrast ratio for large text
- Don't rely on color alone to convey information
- Provide alternative indicators (icons, text, patterns)

## File Upload Accessibility

- Clear label for the file input
- Announce file selection to screen readers
- Show file name and size after selection
- Provide clear error messages for invalid files
- Allow keyboard-only file selection

## Testing

- Test with keyboard only (no mouse)
- Test with screen reader (VoiceOver, NVDA, or Orca)
- Run automated accessibility checks (axe-core)
- Verify color contrast ratios
- Test with browser zoom at 200%

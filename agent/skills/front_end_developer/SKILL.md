---
name: front-end-developer
description: Teaches how to design beutiful UI and front end
license: MIT
compatibility: opencode
metadata:
  agent: builder
  
---

# Skill: Professional Web UI Design System

## Purpose

This skill defines strict UI/UX design standards that must be followed when generating web interfaces.  
The goal is to produce clean, modern, consistent, accessible, and production-ready user interfaces.

The agent MUST follow these rules unless explicitly instructed otherwise.

---

# 1. Core Design Principles

- Prioritize clarity and usability over decoration
- Maintain visual consistency across the entire interface
- Use minimal, intentional styling
- Avoid visual clutter
- Every element must serve a purpose
- Follow accessibility best practices
- Maintain predictable layout behavior

---

# 2. Spacing System (MANDATORY)

## Use 8px Spacing Scale Only

Allowed spacing values:

- 4px (micro spacing)
- 8px
- 16px
- 24px
- 32px
- 48px
- 64px

Do NOT use arbitrary spacing values.

## Section Spacing

- 64px between major sections
- 32px between grouped content blocks
- 16px between related elements (label + input)
- 8px inside compact UI elements

---

# 3. Layout Rules

- Maximum content width: use percentage-based max width (for example 90-95%) instead of a fixed pixel value
- Content must be centered horizontally
- Desktop side padding: minimum 24px
- Mobile side padding: minimum 16px
- Use consistent grid or flex layouts
- Maintain vertical rhythm
- Avoid uneven white space
- Align elements visually across sections

---

# 4. Typography System

## Font Rules

- Use modern sans-serif font
- Maximum 2 font families
- Use size and weight for hierarchy (not color)

## Size Hierarchy

- H1: 36–48px
- H2: 28–32px
- H3: 20–24px
- Body: 16–18px
- Small text: minimum 14px

## Line Height

- Headings: 1.2–1.3
- Body text: 1.5–1.7

## Avoid

- Fully justified text
- Extremely long paragraphs
- Very light gray body text

---

# 5. Buttons

## Size Requirements

- Minimum height: 44px (accessibility requirement)
- Recommended height: 44–48px
- Horizontal padding: 16–24px
- Border radius: 8px (consistent across UI)
- Use one shared button size scale across the product (for example: sm, md, lg)
- Do not mix arbitrary button heights in the same screen or flow
- Primary, secondary, and tertiary buttons must keep the same corner radius shape
- If pill buttons are chosen, all button variants must use pill radius consistently

## Button Hierarchy

1. Primary Button
   - Solid brand color
   - High contrast
   - Used for main action only

2. Secondary Button
   - Outline or subtle background
   - Lower visual emphasis

3. Tertiary Button
   - Text style only

## Rules

- Never place two primary buttons side-by-side
- Minimum 12px spacing between buttons
- Button labels: 1–3 words
- Use action verbs
- Must include:
  - Hover state
  - Focus state
  - Active state
  - Disabled state
  - Loading state (if applicable)

---

# 6. Color System

## Structure

- 1 primary brand color
- 1 accent color
- Neutral grayscale palette (5–7 tones)

## Accessibility

- Minimum contrast ratio: 4.5:1 for body text
- Minimum 3:1 for large text
- Do NOT rely on color alone to communicate meaning
- Error states must include icon or text

## Avoid

- Over-saturation
- Too many colors
- Random color usage

---

# 7. Cards & Containers

- Padding: 24px
- Border radius: 12–16px (consistent)
- Use subtle shadow
- Avoid heavy drop shadows
- Maintain consistent elevation levels

---

# 8. Forms

## Input Requirements

- Labels ABOVE input fields
- Do not rely on placeholders as labels
- Minimum input height: 44px
- Minimum font size: 16px
- 16px vertical spacing between fields

## Validation

- Inline validation preferred
- Clear error messages
- Show success feedback
- Provide confirmation for destructive actions

---

# 9. Navigation

- Maximum 5–7 primary nav items
- Highlight active page clearly
- Use clear wording (no clever phrasing)
- Mobile navigation must collapse cleanly
- Sticky header only when beneficial

---

# 10. Responsive Design

Must support:

- Mobile (320px+)
- Tablet (768px+)
- Desktop (1024px+)

## Rules

- Stack columns on mobile
- Ensure thumb-friendly interactions
- Avoid hover-only functionality
- Maintain consistent spacing scaling

---

# 11. Interaction & Motion

- Animation duration: under 300ms
- Use ease-in-out timing
- Avoid excessive animations
- Motion should clarify, not distract
- Do not animate all elements

---

# 12. Accessibility (MANDATORY)

- Full keyboard navigation support
- Visible focus ring (never remove outlines)
- Proper semantic HTML
- ARIA attributes when needed
- Logical tab order
- Alt text required for images

---

# 13. Visual Hierarchy Rules

Use the following priority to guide attention:

1. Size
2. Weight
3. Contrast
4. Spacing
5. Position

Avoid equal visual weight for all elements.

---

# 14. UX Principles

- One primary goal per section
- Reduce cognitive load
- Group related elements
- Use progressive disclosure
- Avoid overwhelming users with choices

---

# 15. Definition of High-Quality UI

The final UI must feel:

- Clean
- Structured
- Balanced
- Calm
- Intentional
- Accessible
- Professional
- Easy to scan
- Predictable

If the generated UI violates spacing, hierarchy, contrast, or accessibility rules, it must be corrected.

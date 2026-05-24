# PBTH Dashboard Event Hero And PWA Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dashboard hero event selection, remove duplicate event cards below it, and harden the installed-PWA shell with branded icons and safe-area-aware top navigation.

**Architecture:** Keep dashboard decision-making in pure helpers so hero selection and duplicate suppression are testable without rendering. Add public PWA assets in the Vite shell, then apply shared safe-area utilities to the fullscreen screens with sticky headers.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, static PWA assets

---

## Chunk 1: Dashboard Event Model

### Task 1: Lock Hero Selection In Tests

**Files:**
- Modify: `/Users/pk/Documents/CalDEV/pbth/__tests__/unit/events.test.ts`
- Create: `/Users/pk/Documents/CalDEV/pbth/__tests__/unit/dashboard-events.test.ts`

- [ ] **Step 1: Write failing event-helper tests**
- [ ] **Step 2: Run the targeted test command and confirm failure**
- [ ] **Step 3: Implement the minimal hero-selection helper**
- [ ] **Step 4: Run the targeted test command and confirm green**

### Task 2: Remove Hero Duplication From Dashboard Lists

**Files:**
- Modify: `/Users/pk/Documents/CalDEV/pbth/views/Dashboard.tsx`
- Modify: `/Users/pk/Documents/CalDEV/pbth/lib/events.ts`
- Test: `/Users/pk/Documents/CalDEV/pbth/__tests__/unit/dashboard-events.test.ts`

- [ ] **Step 1: Write the failing dashboard-list test**
- [ ] **Step 2: Run the targeted test command and confirm failure**
- [ ] **Step 3: Implement the minimal dashboard section model and wire it into the view**
- [ ] **Step 4: Run the targeted test command and confirm green**

## Chunk 2: PWA Shell And Safe Areas

### Task 3: Lock PWA Shell Expectations In Tests

**Files:**
- Create: `/Users/pk/Documents/CalDEV/pbth/__tests__/unit/pwa-shell.test.ts`
- Modify: `/Users/pk/Documents/CalDEV/pbth/__tests__/unit/vite-config.test.ts`

- [ ] **Step 1: Write failing tests for manifest metadata, icon files, and shell links**
- [ ] **Step 2: Run the targeted test command and confirm failure**
- [ ] **Step 3: Add the manifest, icon assets, and shell metadata**
- [ ] **Step 4: Run the targeted test command and confirm green**

### Task 4: Make Sticky Headers Safe-Area Aware

**Files:**
- Modify: `/Users/pk/Documents/CalDEV/pbth/index.html`
- Modify: `/Users/pk/Documents/CalDEV/pbth/views/EventDetailView.tsx`
- Modify: `/Users/pk/Documents/CalDEV/pbth/views/CreateEventView.tsx`
- Modify: `/Users/pk/Documents/CalDEV/pbth/views/PlayerProfileView.tsx`

- [ ] **Step 1: Add the failing shell test for shared safe-area helpers if coverage is missing**
- [ ] **Step 2: Run the targeted test command and confirm failure**
- [ ] **Step 3: Implement shared top/bottom safe-area utilities and apply them to sticky-header screens**
- [ ] **Step 4: Run the targeted test command and confirm green**

## Chunk 3: Final Verification

### Task 5: Verify End-To-End Build Health

**Files:**
- Verify: `/Users/pk/Documents/CalDEV/pbth`

- [ ] **Step 1: Run unit tests for touched areas**
  Run: `npm test -- --runInBand __tests__/unit/events.test.ts __tests__/unit/dashboard-events.test.ts __tests__/unit/pwa-shell.test.ts __tests__/unit/vite-config.test.ts`
  Expected: all targeted tests pass

- [ ] **Step 2: Run the production build**
  Run: `npm run build`
  Expected: Vite build completes successfully and emits public manifest/icon assets

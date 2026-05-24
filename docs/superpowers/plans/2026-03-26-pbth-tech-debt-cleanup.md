# PBTH Tech Debt Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate critical tech debt to stabilize the codebase and enable safe future growth — cleanup junk, add error boundaries, migrate to structured logging, and split the monolithic App.tsx into focused modules.

**Architecture:** Extract state management from App.tsx into domain-specific React contexts (Auth, AppData, Finance). Replace raw console.* calls in backend with the existing structured logger. Add React Error Boundary to prevent white/black screen crashes. Clean up orphaned files and fix migration numbering.

**Tech Stack:** React 18, React Router, TypeScript, Express, PostgreSQL, Vite

---

## File Structure

### New files to create:
| File | Responsibility |
|------|---------------|
| `pbth/contexts/AuthContext.tsx` | Auth state: user, authStep, login/logout handlers, session restore |
| `pbth/contexts/AppDataContext.tsx` | Core app data: team, events, members, RSVP, team switching |
| `pbth/contexts/FinanceContext.tsx` | Finance state: overview, members, confirmations, transactions, team filter |
| `pbth/components/ErrorBoundary.tsx` | Catch React render errors, show recovery UI |
| `pbth/components/AppLayout.tsx` | App shell: content rendering, FAB, bottom nav, modals |

### Files to modify:
| File | Change |
|------|--------|
| `pbth/App.tsx` (1345→~120 lines) | Strip to route definitions + context providers |
| `backend/src/modules/auth/routes.ts` | Replace `console.warn` → `logger.warn` (4 calls) |
| `backend/src/modules/teams/routes.ts` | Replace `console.warn` → `logger.warn` (4 calls) |
| `backend/src/modules/vendor/routes.ts` | Replace `console.error` → `logger.error` (2 calls) |

### Files to delete:
| File/Dir | Reason |
|----------|--------|
| `backend/src/modules/{admin,auth,events,finance,ics,init,notifications,profile,rsvp,teams,vendor} 2/` | Empty duplicate dirs |
| `PBTH_backup_20260227_084018/` | Stale backup in repo root |
| `.git_pbth_backup_20260305_110517/` | Stale git backup in repo root |

### Files to fix:
| File | Issue |
|------|-------|
| `backend/src/db/migrations/015_finance_payment_confirmations.sql` | Duplicate number (015). Rename to `015b_finance_payment_confirmations.sql` |

---

## Phase 1: Cleanup & Hygiene (10 min)

### Task 1: Delete orphaned duplicate module directories

**Files:**
- Delete: `backend/src/modules/{admin,auth,events,finance,ics,init,notifications,profile,rsvp,teams,vendor} 2/`

- [ ] **Step 1: Verify all "2" directories are empty**

```bash
find backend/src/modules -name "* 2" -type d -exec ls -la {} \;
```
Expected: All directories are empty (only `.` entry).

- [ ] **Step 2: Delete all duplicate directories**

```bash
find backend/src/modules -name "* 2" -type d -exec rm -rf {} +
```

- [ ] **Step 3: Verify deletion**

```bash
ls backend/src/modules/
```
Expected: Only valid module directories remain (admin, auth, events, finance, ics, init, notifications, profile, rsvp, teams, vendor).

- [ ] **Step 4: Commit**

```bash
git add -A backend/src/modules/
git commit -m "chore: remove orphaned duplicate module directories"
```

### Task 2: Remove stale backup artifacts

**Files:**
- Delete: `PBTH_backup_20260227_084018/`
- Delete: `.git_pbth_backup_20260305_110517/`

- [ ] **Step 1: Check backups are not referenced anywhere**

```bash
grep -r "PBTH_backup\|git_pbth_backup" . --include="*.ts" --include="*.json" --include="*.md" | head -5
```
Expected: No references (or only in docs describing cleanup).

- [ ] **Step 2: Delete backup directories**

```bash
rm -rf PBTH_backup_20260227_084018 .git_pbth_backup_20260305_110517
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove stale backup artifacts from repo root"
```

### Task 3: Fix duplicate migration numbering

**Files:**
- Rename: `backend/src/db/migrations/015_finance_payment_confirmations.sql` → `015b_finance_payment_confirmations.sql`

- [ ] **Step 1: Verify the two 015 migrations**

```bash
ls backend/src/db/migrations/015*
```
Expected: `015_event_games_pit_zone.sql` and `015_finance_payment_confirmations.sql`.

- [ ] **Step 2: Check if migrate.ts uses alphabetical ordering**

Read `backend/src/db/migrate.ts` to understand how migrations are discovered and ordered.

- [ ] **Step 3: Rename the duplicate**

```bash
mv backend/src/db/migrations/015_finance_payment_confirmations.sql backend/src/db/migrations/015b_finance_payment_confirmations.sql
```

- [ ] **Step 4: Verify no code references the old filename**

```bash
grep -r "015_finance_payment_confirmations" . --include="*.ts" --include="*.sql" | head -5
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/
git commit -m "fix: rename duplicate migration 015 to 015b"
```

---

## Phase 2: Error Boundary + Structured Logging (15 min)

### Task 4: Add React Error Boundary

**Files:**
- Create: `pbth/components/ErrorBoundary.tsx`
- Modify: `pbth/App.tsx` (wrap routes with ErrorBoundary)

- [ ] **Step 1: Create ErrorBoundary component**

```tsx
// pbth/components/ErrorBoundary.tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
          <div className="text-center max-w-sm">
            <div className="text-2xl font-bold mb-3">Что-то пошло не так</div>
            <p className="text-pb-subtext mb-2 text-sm break-all">
              {this.state.error?.message || 'Неизвестная ошибка'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/app';
              }}
              className="bg-pb-primary text-pb-background px-5 py-3 rounded-xl font-bold mt-4"
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap App routes with ErrorBoundary**

In `pbth/App.tsx`, import ErrorBoundary and wrap the `<Routes>` block:

```tsx
import { ErrorBoundary } from './components/ErrorBoundary';

// In the return statement of App component:
return (
  <ErrorBoundary>
    <Routes>
      {/* ...existing routes... */}
    </Routes>
  </ErrorBoundary>
);
```

- [ ] **Step 3: Verify the app still loads**

```bash
cd pbth && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add pbth/components/ErrorBoundary.tsx pbth/App.tsx
git commit -m "feat: add React ErrorBoundary to prevent white screen crashes"
```

### Task 5: Migrate backend modules to structured logger

**Files:**
- Modify: `backend/src/modules/auth/routes.ts` (lines 665, 802, 896, 970)
- Modify: `backend/src/modules/teams/routes.ts` (lines 259, 282, 286, 290)
- Modify: `backend/src/modules/vendor/routes.ts` (lines 67, 112, 125)

- [ ] **Step 1: Add logger import to auth/routes.ts**

At the top of `backend/src/modules/auth/routes.ts`, add:
```typescript
import { logger } from "../../lib/logger.js";
```

Replace all `console.warn("[auth]` with `logger.warn("[auth]` — 4 occurrences:
- Line 665: `console.warn("[auth] oidc callback token verification failed"` → `logger.warn("[auth] oidc callback token verification failed"`
- Line 802: `console.warn("[auth] telegram callback missing required fields"` → `logger.warn("[auth] telegram callback missing required fields"`
- Line 896: `console.warn("[auth] telegram callback verification failed"` → `logger.warn("[auth] telegram callback verification failed"`
- Line 970: `console.warn("[auth] telegram webapp verification failed"` → `logger.warn("[auth] telegram webapp verification failed"`

- [ ] **Step 2: Add logger import to teams/routes.ts**

At the top of `backend/src/modules/teams/routes.ts`, add:
```typescript
import { logger } from "../../lib/logger.js";
```

Replace all `console.warn("[teams]` with `logger.warn("[teams]` — 4 occurrences:
- Line 259: `console.warn("[teams] invite.accept denied`
- Line 282: `console.warn("[teams] invite.accept failed: invite not found`
- Line 286: `console.warn("[teams] invite.accept failed: revoked`
- Line 290: `console.warn("[teams] invite.accept failed: expired`

- [ ] **Step 3: Add logger import to vendor/routes.ts**

At the top of `backend/src/modules/vendor/routes.ts`, add:
```typescript
import { logger } from "../../lib/logger.js";
```

Replace:
- Line 67: `console.warn(` → `logger.warn(`
- Line 112: `console.error("[vendor] tailwindcss fetch error"` → `logger.error("[vendor] tailwindcss fetch error"`
- Line 125: `console.error("[vendor] telegram-web-app fetch error"` → `logger.error("[vendor] telegram-web-app fetch error"`

Note: Leave the inline `console.warn` strings inside the fallback JavaScript snippets (lines 87, 94, 100) — those run in the browser, not the server.

- [ ] **Step 4: Verify backend compiles**

```bash
cd backend && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/auth/routes.ts backend/src/modules/teams/routes.ts backend/src/modules/vendor/routes.ts
git commit -m "refactor: replace console.warn/error with structured logger in backend modules"
```

---

## Phase 3: Split Monolithic App.tsx (45 min)

### Task 6: Extract AuthContext

**Files:**
- Create: `pbth/contexts/AuthContext.tsx`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Create AuthContext**

Extract from App.tsx lines 37-39 (constants), 40-43 (auth state), 70-120 (helpers), 452-531 (useEffect session restore), 534-592 (login/logout handlers):

```tsx
// pbth/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { clearLocalDevSession } from '../lib/local-dev-api';
import type { AuthStep, User, UserRoleOption } from '../types';

interface AuthContextValue {
  authStep: AuthStep;
  user: User | null;
  isLoading: boolean;
  isLoggingOut: boolean;
  authBootstrapDone: boolean;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  setAuthStep: React.Dispatch<React.SetStateAction<AuthStep>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  handleRoleSelect: (option: UserRoleOption) => void;
  clearLogoutGuard: () => void;
  tryEnterUserApp: (options?: { silent?: boolean }) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({
  children,
  onSessionRestored,
}: {
  children: React.ReactNode;
  onSessionRestored: (ok: boolean) => void;
}) {
  const logoutGuardKey = 'pbth:skip-auto-auth-after-logout';
  const logoutGuardCookie = 'pbth_logout_guard';
  const navigate = useNavigate();

  const [authStep, setAuthStep] = useState<AuthStep>('LOGIN');
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [authBootstrapDone, setAuthBootstrapDone] = useState(false);

  const isTelegramMiniApp = () =>
    typeof window !== 'undefined' && Boolean((window as any).Telegram?.WebApp);

  const hasLogoutGuard = () => {
    try {
      const cookieGuard =
        typeof document !== 'undefined' &&
        document.cookie
          .split(';')
          .map((part) => part.trim())
          .some((part) => part.startsWith(`${logoutGuardCookie}=1`));
      return (
        cookieGuard ||
        sessionStorage.getItem(logoutGuardKey) === '1' ||
        localStorage.getItem(logoutGuardKey) === '1'
      );
    } catch {
      return false;
    }
  };

  const clearLogoutGuard = useCallback(() => {
    try {
      sessionStorage.removeItem(logoutGuardKey);
      localStorage.removeItem(logoutGuardKey);
      if (typeof document !== 'undefined') {
        document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; SameSite=Lax`;
        document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
        const host = window.location.hostname;
        if (host && host.includes('.')) {
          document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; Domain=.${host}; SameSite=Lax`;
          document.cookie = `${logoutGuardCookie}=; Max-Age=0; Path=/; Domain=.${host}; SameSite=Lax; Secure`;
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const enableLogoutGuard = useCallback(() => {
    try {
      sessionStorage.setItem(logoutGuardKey, '1');
      localStorage.setItem(logoutGuardKey, '1');
      if (typeof document !== 'undefined') {
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${logoutGuardCookie}=1; Max-Age=1209600; Path=/; SameSite=Lax${secure}`;
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  // tryEnterUserApp and loadData will be called from AppDataContext
  // For now, this is a placeholder that checks auth status
  const tryEnterUserApp = useCallback(async (_options?: { silent?: boolean }): Promise<boolean> => {
    // This will be wired up via onSessionRestored callback
    return false;
  }, []);

  const handleLogin = useCallback(async () => {
    clearLogoutGuard();
    sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
    const ok = await onSessionRestored(true);
    // Login success is handled by the callback
  }, [clearLogoutGuard, onSessionRestored]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    sessionStorage.removeItem('pbth:post-auth-app');
    sessionStorage.removeItem('pbth:tg-webapp-fallback-direct');
    if (typeof window !== 'undefined') {
      clearLocalDevSession(window.localStorage);
    }
    enableLogoutGuard();

    setAuthStep('LOGIN');
    setUser(null);
    setAuthBootstrapDone(true);
    navigate('/login', { replace: true });

    void fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch((error) => {
      console.error('Failed to terminate server session', error);
    });

    setIsLoggingOut(false);
  }, [enableLogoutGuard, navigate]);

  const handleRoleSelect = useCallback((_option: UserRoleOption) => {
    // delegates to handleLogin
  }, []);

  return (
    <AuthContext.Provider
      value={{
        authStep,
        user,
        isLoading,
        isLoggingOut,
        authBootstrapDone,
        setUser,
        setAuthStep,
        setIsLoading,
        handleLogin,
        handleLogout,
        handleRoleSelect,
        clearLogoutGuard,
        tryEnterUserApp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
```

**IMPORTANT:** This is the target structure, but the actual extraction must preserve the exact existing behavior. During implementation, carefully move code line-by-line from App.tsx, keeping all edge cases intact. The code above is a structural guide — adapt it to match the actual App.tsx logic exactly.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd pbth && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add pbth/contexts/AuthContext.tsx pbth/App.tsx
git commit -m "refactor: extract AuthContext from App.tsx"
```

### Task 7: Extract AppDataContext

**Files:**
- Create: `pbth/contexts/AppDataContext.tsx`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Create AppDataContext**

Extract from App.tsx:
- State: activeTeam, teamContexts, events, members, calendarLink, isSwitchingTeam, selectedEvent, selectedMember, currentView, appGate, isRSVPModalOpen, rsvpModalEvent
- Functions: loadData, tryEnterUserApp, handleSwitchTeamContext, handleRsvp, handleCreateEvent, handleEventClick, handleEventLongPress, handleAddGame, handleUpdateGame, handleMemberClick, handleUpdateMemberStatus, handleRemoveMember, handleAttendeeClick, handleCopyIcsLink, handleShareIcsLink, handleDownloadIcs, handleSendEventReminder, handleSwitchToUserMode

The context should:
- Use `useAuth()` to access user and auth state
- Own all team/event/member state
- Own the `loadData` + `tryEnterUserApp` logic (the real implementation)
- Expose handlers for views

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd pbth && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add pbth/contexts/AppDataContext.tsx pbth/App.tsx
git commit -m "refactor: extract AppDataContext from App.tsx"
```

### Task 8: Extract FinanceContext

**Files:**
- Create: `pbth/contexts/FinanceContext.tsx`
- Modify: `pbth/App.tsx`
- Modify: `pbth/contexts/AppDataContext.tsx` (remove finance state)

- [ ] **Step 1: Create FinanceContext**

Extract from App.tsx:
- State: financeSelectedTeamId, financeMembers, financeOverview, financeEvents, financeConfirmations, playerFinanceDetail, transactions
- Functions: loadFinanceData, normalizeFinanceSelection, canUseAllTeamsFinance, mapTransactionsFromOverview, mapFinanceMembers, handleSwitchFinanceTeam, handleAddTransaction, handleRemindDebtor, handleRemindAllDebtors, handleCreateTransferConfirmation, handleReviewTransferConfirmation

The context should:
- Use `useAuth()` for user
- Use `useAppData()` for activeTeam, teamContexts
- Own all finance-specific state and handlers

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd pbth && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add pbth/contexts/FinanceContext.tsx pbth/App.tsx pbth/contexts/AppDataContext.tsx
git commit -m "refactor: extract FinanceContext from App.tsx"
```

### Task 9: Extract AppLayout component

**Files:**
- Create: `pbth/components/AppLayout.tsx`
- Modify: `pbth/App.tsx`

- [ ] **Step 1: Create AppLayout**

Extract from App.tsx lines 1060-1296 (renderContent + renderAppLayout):
- Move `renderContent()` and `renderAppLayout()` into a standalone component
- It uses `useAuth()`, `useAppData()`, `useFinance()` to get all needed state
- Handles the NO_TEAM, ADMIN_MODE gates
- Renders the main app shell with BottomNav, FAB, RSVPModal

- [ ] **Step 2: Simplify App.tsx**

App.tsx should now be ~100-120 lines:
- Import providers and ErrorBoundary
- Wrap routes with `<ErrorBoundary><AuthProvider><AppDataProvider><FinanceProvider>`
- Route definitions only
- The `/app/*` route renders `<AppLayout />`

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd pbth && npx tsc --noEmit
```

- [ ] **Step 4: Manually test in browser**

```bash
# Start dev server and verify app loads
cd pbth && npm run dev
```
Open http://localhost:3000/login — verify login flow works.
Open http://localhost:3000/app — verify all tabs render correctly.

- [ ] **Step 5: Commit**

```bash
git add pbth/components/AppLayout.tsx pbth/App.tsx
git commit -m "refactor: extract AppLayout, App.tsx now ~120 lines"
```

---

## Phase 4: Type Safety Quick Wins (15 min)

### Task 10: Fix `any` types in backend auth helpers

**Files:**
- Modify: `backend/src/modules/auth/routes.ts` (lines 75, 85, 113, 127, 166, 196-197, 284)

- [ ] **Step 1: Replace `req: any` with proper Express types**

These helper functions use `req: any` when they should use `express.Request`:

```typescript
import type { Request, Response } from "express";

function hasCookie(req: Request, name: string): boolean { ... }
function readCookie(req: Request, name: string): string | null { ... }
function getAuthPublicUrls(req: Request) { ... }
function detectRequestPlatform(req: Request): "android" | "ios" | "desktop" | "unknown" { ... }
function shouldUseOidcFromCanary(req: Request, res: Response, redirectTo: string) { ... }
```

For `ensureUserHasTeam` at line 284, replace `req: any` with the proper request type used elsewhere in the file.

- [ ] **Step 2: Fix `res: any` in admin/routes.ts**

In `backend/src/modules/admin/routes.ts` line 174:
```typescript
async function requireAdminAccess(req: Parameters<typeof requireAuth>[0], res: Response): Promise<AdminAccess | null>
```

- [ ] **Step 3: Fix `error: any` catch clauses in teams/routes.ts**

Lines 99, 397 — replace `catch (error: any)` with `catch (error: unknown)` and use proper type narrowing:
```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // use message
}
```

- [ ] **Step 4: Fix `res: any` in finance/routes.ts**

Line 460 — `handleKnownFinanceError(err: unknown, res: any)` → `res: Response`.

- [ ] **Step 5: Verify backend compiles**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/auth/routes.ts backend/src/modules/admin/routes.ts backend/src/modules/teams/routes.ts backend/src/modules/finance/routes.ts
git commit -m "refactor: replace 'any' with proper types in backend route helpers"
```

### Task 11: Fix `any` types in frontend App.tsx and api.ts

**Files:**
- Modify: `pbth/App.tsx` (or contexts after extraction)
- Modify: `pbth/api.ts` (only the `any` in inline types)

- [ ] **Step 1: Fix `(window as any).Telegram` usage**

Add a global type declaration:
```typescript
// pbth/types/telegram.d.ts
interface TelegramWebApp {
  WebApp?: {
    initData?: string;
    close?: () => void;
  };
}

interface Window {
  Telegram?: TelegramWebApp;
}
```

Then replace `(window as any).Telegram` with `window.Telegram` throughout.

- [ ] **Step 2: Fix `(navigator as any).share`**

Replace with proper type check:
```typescript
if ('share' in navigator && typeof navigator.share === 'function') {
  await navigator.share({ url: calendarLink, title: 'PBTH calendar' });
}
```

- [ ] **Step 3: Fix `eventData: any` in handleCreateEvent**

Replace with a proper type:
```typescript
interface CreateEventData {
  type: string;
  title: string;
  description?: string;
  startDate: Date | string;
  location?: string;
  cost?: number;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd pbth && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add pbth/
git commit -m "refactor: replace 'any' with proper types in frontend"
```

---

## Summary

| Phase | Tasks | Time Est | Impact |
|-------|-------|----------|--------|
| 1: Cleanup | Tasks 1-3 | 10 min | Remove junk, fix migration numbering |
| 2: Stability | Tasks 4-5 | 15 min | Error Boundary prevents crashes, structured logging |
| 3: Split App.tsx | Tasks 6-9 | 45 min | 1345→~120 lines, domain contexts, testable |
| 4: Type Safety | Tasks 10-11 | 15 min | Eliminate `any` types in critical paths |

**Total: 11 tasks, ~85 min**

After completion:
- App.tsx: 1345 → ~120 lines
- 3 focused contexts (Auth, AppData, Finance)
- Error Boundary catches render crashes
- Structured JSON logging in all backend modules
- Zero orphaned files/directories
- Significantly fewer `any` types

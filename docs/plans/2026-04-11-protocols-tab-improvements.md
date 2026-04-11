# Protocols Tab Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify today's buttons to just "Manage stack", rename/improve the supplement picker for past dates, add hidden supplements toggle, and replace the mobile bottom sheet with a proper side panel on desktop.

**Architecture:** All changes are in `src/components/Stack.jsx`. The `availableToLog` filter needs adjustment to respect a new `showHiddenInPicker` toggle state. The log picker modal gets a conditional render path: bottom sheet on mobile, slide-in side panel on desktop.

**Tech Stack:** React, inline styles (project convention)

---

### Task 1: Remove "Add supplement" button on today's view

**Files:**
- Modify: `src/components/Stack.jsx:708-729`

**Step 1: Change the condition on the "Add supplement" button**

The current button at line 708 shows when `!showManageStack && availableToLog.length > 0`. Change it to also require `!isToday`:

```jsx
{!showManageStack && !isToday && availableToLog.length > 0 && (
```

**Step 2: Rename the button text**

At line 727-728, change:
```jsx
          Add supplement
```
to:
```jsx
          Log supplement
```

**Step 3: Verify in browser**

- On today: only "Manage stack" button should appear
- On a past date: "Log supplement" button should appear

**Step 4: Commit**

```bash
git add src/components/Stack.jsx
git commit -m "fix: show only Manage stack on today, rename to Log supplement for past dates"
```

---

### Task 2: Add "Show hidden" toggle to the log picker

**Files:**
- Modify: `src/components/Stack.jsx:295-304` (availableToLog filter)
- Modify: `src/components/Stack.jsx:1266-1401` (log picker modal)

**Step 1: Add state for the hidden toggle in the picker**

There's already `showHiddenItems` state (line 25) used in Manage Stack. Add a separate state for the picker to keep them independent. Near line 25, add:

```jsx
const [showHiddenInPicker, setShowHiddenInPicker] = useState(false);
```

**Step 2: Reset toggle when picker opens**

Find where `setShowLogPicker(true)` is called (line 710). Add a reset before it:

```jsx
onClick={() => { setShowHiddenInPicker(false); setShowLogPicker(true); }}
```

**Step 3: Update availableToLog to respect the toggle**

At lines 295-304, the current filter hides inactive supplements on today (`if (isToday && !i.active) return false`). On past dates it already shows all. Change the filter so on past dates, hidden supplements are only included when `showHiddenInPicker` is true:

```jsx
const availableToLog = (() => {
  const displayedIds = new Set(displayItems.map(i => i.id));
  return stackItems.filter(i => {
    if (displayedIds.has(i.id)) return false;
    if (isToday && !i.active) return false;
    if (!isToday && !i.active && !showHiddenInPicker) return false;
    return true;
  }).sort((a, b) => (a.order || 0) - (b.order || 0));
})();
```

**Step 4: Add the toggle UI in the log picker**

Inside the log picker modal, after the supplement list map (after line 1371) and before the "Add new supplement" button (line 1372), add a "Show hidden" toggle:

```jsx
{/* Show hidden toggle */}
<button
  onClick={() => setShowHiddenInPicker(prev => !prev)}
  style={{
    width: '100%',
    padding: '12px 20px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    color: showHiddenInPicker ? '#a78bfa' : '#6b7280',
    fontSize: '13px',
    fontWeight: '400',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  }}
>
  <span style={{ fontSize: '14px' }}>{showHiddenInPicker ? '◉' : '○'}</span>
  Show hidden
</button>
```

**Step 5: Add "(hidden)" badge to hidden supplements in the list**

In the supplement list map (around line 1360), update the name display to show a badge for inactive items:

```jsx
<span>{item.name}</span>
{!item.active && (
  <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '4px' }}>(hidden)</span>
)}
```

**Step 6: Rename the picker header**

At line 1302-1303, change `Add supplement` to `Log supplement`.

**Step 7: Verify in browser**

- Navigate to a past date
- Click "Log supplement" — should show only active supplements
- Click "Show hidden" toggle — hidden supplements should appear with "(hidden)" badge
- Logging a hidden supplement should not change its active status
- Re-opening the picker should reset the toggle to off

**Step 8: Commit**

```bash
git add src/components/Stack.jsx
git commit -m "feat: add Show hidden toggle to log supplement picker"
```

---

### Task 3: Desktop side panel for log picker

**Files:**
- Modify: `src/components/Stack.jsx:1266-1401` (log picker modal)

**Step 1: Replace the log picker modal with conditional desktop/mobile rendering**

Replace the entire log picker block (lines 1266-1401) with a conditional render. The mobile path keeps the existing bottom sheet. The desktop path renders a side panel.

**Mobile (keep existing):** Bottom sheet with backdrop, `alignItems: 'flex-end'`, max-width 500px, centered.

**Desktop (new):** Side panel structure:

```jsx
{showLogPicker && (
  isDesktop ? (
    /* Desktop: side panel */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={() => setShowLogPicker(false)}
    >
      <div
        style={{
          width: '380px',
          height: '100%',
          background: '#1a1b1e',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
            Log supplement
          </h3>
          <button
            onClick={() => setShowLogPicker(false)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#9ca3af',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: '6px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable supplement list */}
        <div style={{
          overflowY: 'auto',
          flex: 1,
        }}>
          {/* ...same list items as mobile, same Show hidden toggle, same Add new supplement button... */}
        </div>
      </div>
    </div>
  ) : (
    /* Mobile: existing bottom sheet (unchanged) */
    <div style={{ /* ...existing backdrop styles... */ }}>
      {/* ...existing bottom sheet content... */}
    </div>
  )
)}
```

**Step 2: Add the slideInRight keyframe animation**

Find where `modalIn` keyframe is defined in the codebase and add alongside it:

```css
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

If keyframes are injected via JS (useEffect), add it the same way. If they're inline via a `<style>` tag in the component, add it there.

**Step 3: Extract shared list content**

To avoid duplicating the supplement list, toggle, and "Add new" button between desktop and mobile, extract the list content into a local variable above the return, e.g.:

```jsx
const logPickerContent = (
  <>
    {availableToLog.length === 0 ? (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
        All supplements have been logged for this day.
      </div>
    ) : availableToLog.map((item) => (
      // ...existing item buttons with (hidden) badge...
    ))}
    {/* Show hidden toggle */}
    {/* ...toggle button... */}
    {/* Add new supplement */}
    {/* ...add new button... */}
  </>
);
```

Then use `{logPickerContent}` inside both the mobile bottom sheet's scrollable div and the desktop side panel's scrollable div.

**Step 4: Verify in browser**

- Desktop: click "Log supplement" on a past date — side panel should slide in from right
- Click backdrop — panel should dismiss
- Panel should be full height, ~380px wide
- Supplement list should scroll within the panel
- "Show hidden" toggle and "Add new supplement" should work
- Mobile: behavior unchanged (bottom sheet)

**Step 5: Commit**

```bash
git add src/components/Stack.jsx
git commit -m "feat: desktop side panel for Log supplement picker"
```

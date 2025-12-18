# Symptom Tracker v3.3.19

A mobile-first health tracking PWA for symptoms and supplements with cloud sync.

## Quick Start

1. Open `index.html` in Safari (iOS) or any browser
2. **iOS:** Tap Share → "Add to Home Screen" for app-like experience
3. Sign in with Google or Email to enable cloud sync
4. Data persists locally and syncs automatically when signed in

## Features

### Symptoms Tab
- **2D gesture interface**: Hold 200ms → drag to set severity (0-5)
- **Rapid Entry mode**: Quick logging with keyboard shortcuts (desktop: 0-5 keys)
- **Quick copy button**: Tap to copy recent days, long-press to change days (1/3/7/14)
- **Calendar navigation** with entry indicators
- **Pin symptoms** to top of list (⊙ icon)
- **Daily notes**: Add notes for each day
- **2 tracking modes**: Simple (once daily) or AM/PM (morning/evening)

### Stack Tab  
- Track daily supplements with checkboxes
- **Multiplier buttons**: ½×, 2×, 3× dose adjustments (right side)
- **Swipe to delete** with smooth animation
- Drag to reorder
- Tap dose to edit

### Insights Tab
- 30/60/90 day trend analysis
- Symptom clustering detection
- Copy data for AI analysis

### Settings
- **Cloud Sync**: Google Sign-In or Email/Password authentication
- **History**: View and sort all entries
- **Export**: Markdown tables, CSV download, or copy for AI
- **Manage Symptoms/Supplements**: Add, edit, hide, restore
- **Backup**: Manual save/load via Files app (iCloud)
- **Check for Updates**: Force refresh to get latest version
- **Password Reset**: For email accounts

## Cloud Sync (Firebase)

When deployed to GitHub Pages or a web server:

1. Go to Settings
2. Sign in with Google or create an Email account
3. Data syncs automatically every 5 seconds
4. Works across all devices signed into the same account

**Note:** Cloud sync requires HTTPS. Not available when running from local file.

## Manual Backup (iCloud)

For offline backup or when cloud sync isn't available:

1. Settings → Backup → **Save Backup**
2. Save to Files → iCloud Drive
3. On other device: **Load Backup** → select file

## Keyboard Shortcuts (Desktop)

### Rapid Entry Mode
| Key | Action |
|-----|--------|
| 0-5 | Log severity |
| Space / → | Skip to next |
| Z | Undo last |
| Esc | Close |

## Tech Stack

- React 18 (via CDN)
- Firebase Auth + Firestore
- Single HTML file, no build step
- Works offline after initial load
- PWA-capable

## Deployment

### GitHub Pages
1. Push `index.html`, `manifest.json`, `apple-touch-icon.png`, and `favicon.svg` to repo
2. Enable GitHub Pages in repo settings
3. Add your domain to Firebase authorized domains

### Local Development
```bash
python3 -m http.server 8080
# or
npx serve .
```

---

## Changelog

### v3.3.19 (2024-12-18)
- **Explosion animation**: Completion celebration changed from party streamers to radial explosion
  - 24 particles burst outward in all directions from center
  - Inner ring of 12 smaller, faster particles
  - Center flash effect
  - Faster, more impactful animation (0.8s vs 2s)

### v3.3.18 (2024-12-18)
- **Rapid Entry redesigned**:
  - Back button now navigates to previous symptom (not undo)
  - Current selection shown with distinctive border + checkmark + glow
  - Tap current selection to clear it, tap different value to change
  - Progress bar shows current position (purple) and completion status (green)
  - Counter shows "X of Y" position
  - Skip at end closes rapid entry instead of looping
  - Can freely navigate back/forward through all symptoms
  - Z key or ← Back button goes to previous symptom

### v3.3.17 (2024-12-17)
- **Removed full-screen completion modal**: All completions now use toast notifications only
  - Prevents app from hanging when completion triggers
  - Shows "✓ Morning complete!" or "✓ All symptoms logged!" toast

### v3.3.16 (2024-12-17)
- **Check for Updates feedback fix**: Now stays on Settings page and shows toast after reload

### v3.3.15 (2024-12-17)
- **Last recorded fix (complete)**: Now correctly shows this morning's value when logging PM
  - PM logging: shows AM from today if exists, else most recent before today
  - AM logging: shows most recent from before today

### v3.3.14 (2024-12-17)
- **Check for Updates feedback**: Shows spinning loader while checking, toast confirmation after reload

### v3.3.13 (2024-12-17)
- **Last recorded fix**: When logging past dates, shows entries from BEFORE that date (not today's data)

### v3.3.12 (2024-12-17)
- **Copy dropdown fix**: Long-press on mobile now stays open properly
- **Swipe-to-delete animation**: Items smoothly collapse, others slide up
- **Mode switching data preservation**: Switching between AM/PM and Simple modes no longer loses data
  - AM/PM → Simple: Shows averaged severity
  - Simple → AM/PM: Shows daily entries as morning entries
- **Consistent page widths**: All pages use 600px max-width on desktop

### v3.3.11 (2024-12-17)
- **Check for Updates**: Now force-refreshes the app (clears caches, reloads)
- **Empty by default**: App starts with no pre-populated symptoms or supplements
- **High-res icon**: 180x180 PNG for Safari homescreen bookmarks
- **Haptic feedback**: Added to swipe-to-delete

### v3.3.10 (2024-12-16)
- **Quick copy button redesign**: Shows days count (3d), long-press for dropdown
- **Configurable copy days**: Choose 1, 3, 7, or 14 days (persists in localStorage)
- **Symptom tile fix**: Consistent height when selecting severity
- **Unified toast notifications**: All copy actions show consistent feedback
- **Stack multiplier repositioned**: Moved to far right of item row
- **Rapid Entry improvements**: Separate Skip and Close buttons
- **Undo shortcut changed**: Now uses Z key instead of Backspace

### v3.3.9 (2024-12-16)
- **Markdown table export**: Copy data as formatted tables for AI
- **Quick copy button**: One-tap copy on Symptoms page
- **Animated toast**: Feedback when copying to clipboard

### v3.3.8 (2024-12-16)
- **Midnight detection fix**: Render-based date check for reliable day switching
- **Stack auto-copy**: Automatically copies yesterday's checked items
- **Multiple event triggers**: visibilitychange, pageshow, focus, touchstart

### v3.3.7 (2024-12-14)
- **Keyboard shortcuts for Rapid Entry**: Space to skip, Backspace to undo, Esc to close
- **Desktop shortcut labels**: Subtle key hints shown on desktop only

### v3.3.6 (2024-12-14)
- **Navigation fixes**: All settings sub-pages return to Settings when closed
- **Consistent page layouts**: All pages now use 28px titles with "Done" button
- **Export redesign**: Full-screen layout matching other pages, iOS-style sections

### v3.3.5 (2024-12-14)
- **iOS-styled Settings**: Complete redesign with grouped sections and rounded cards
- **Section headers**: DATA, MANAGE, TRACKING MODE, BACKUP, DANGER ZONE, ABOUT
- **Cleaner UI**: Removed 3D icons, flat design throughout
- **Simplified buttons**: Text-only "Done" buttons, chevron arrows for navigation

### v3.3.4 (2024-12-14)
- **Password reset debugging**: Alert popup confirms email sent
- **Console logging**: Debug output for password reset flow
- **Better error messages**: Shows error codes for troubleshooting

### v3.3.3 (2024-12-14)
- **UI spacing fixes**: "Create one" and "Forgot password?" properly separated
- **Tablet support**: Increased max-width (800px symptoms/stack, 600px settings)

### v3.3.2 (2024-12-14)
- **Forgot password**: Password reset link for email accounts
- **Firebase integration**: Uses sendPasswordResetEmail()

### v3.3.1 (2024-12-14)
- **Email auth in browser**: Email/password available in all modes (not just PWA)

### v3.3.0 (2024-12-14)
- **Email/Password authentication**: Sign up and sign in with email
- **Smart error messages**: Helpful feedback for auth errors
- **Sign-up/Sign-in toggle**: Easy switching between modes

### v3.2.6 (2024-12-13)
- **PWA auth fix**: Fixed standalone mode detection for auth

### v3.2.5 (2024-12-13)
- **Hidden item management**: Removed delete from hidden items (restore only)

### v3.2.4 (2024-12-13)
- **Pin UX improvements**: Closes overlay immediately, no special styling

### v3.2.3 (2024-12-13)
- **Auto-sync optimization**: Reduced sync delay to 5 seconds
- **Removed manual sync button**: Sync is now fully automatic

### v3.2.2 (2024-12-13)
- **Popup auth fix**: Fixed Google Sign-In reliability with popup-first approach

### v3.2.1 (2024-12-13)
- **Environment detection**: Auth checks for supported environments

### v3.2.0 (2024-12-13)
- **Firebase Cloud Sync**: Real-time sync with Firestore
- **Google Sign-In**: One-tap authentication
- **PWA detection**: Different auth flows for browser vs installed app
- **Offline persistence**: Firestore cache for offline access

### v3.1.0 (2024-12-13)
- **Rapid Entry mode**: Fast symptom logging with progress bar
- **Undo support**: Back button in rapid entry
- **Period switching**: Switch AM/PM when current period complete

### v3.0.0 (2024-12-12)
- **Major refactor**: Consolidated codebase
- **Pinned symptoms**: Pin frequently-used symptoms to top
- **Daily notes**: Add text notes for each day
- **Search**: Find symptoms quickly (hidden by default)
- **Completion celebration**: Animation when all symptoms logged

### v2.0.0 (2024-12-12)
- **Drag to reorder**: Hold and drag symptoms/supplements
- **Swipe to delete**: Swipe left on items (active items only)
- **Multiplier buttons**: Quick dose adjustments (½×, 2×, 3×)
- **Error boundary**: Graceful error handling

### v1.6 (2024-12-12)
- Settings in tab bar
- History & Export in Settings
- Copy for AI export

### v1.5 (2024-12-12)
- iCloud Backup/Restore
- Full-screen views

### v1.0-v1.4 (2024-12-11)
- Initial release through Stack mode additions

---

## License

MIT

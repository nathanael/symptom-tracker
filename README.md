# Symptom Tracker v3.0.4

A mobile-first health tracking PWA for logging symptoms and supplements with cloud sync.

## Features

### Symptom Tracking
- **Tap-to-log interface**: Tap any symptom to reveal severity picker (0-5 scale)
- **In-place editing**: Numbers appear where symptom name was - minimal thumb movement
- **AM/PM tracking mode**: Log morning and evening separately
- **Sticky time selection**: AM/PM choice persists across symptoms until changed
- **Pin symptoms**: Keep frequently-used symptoms at the top
- **Color-coded severity**: Visual feedback from green (0) to red (5)

### Supplement Stack
- **Daily checklist**: Track supplements with checkboxes
- **Dose multipliers**: ½×, 2×, 3× buttons for flexible dosing
- **Copy Yesterday**: Precisely copies yesterday's selections (checked and unchecked)
- **Quick actions**: "✓ All" and "✕ Clear" buttons

### Data Management
- **Calendar view**: Navigate to any past date
- **Daily notes**: Add context about diet, sleep, stress, etc.
- **History view**: Sortable table of all entries
- **CSV export**: Download data for analysis
- **Local storage**: All data persists in browser
- **Cloud sync**: Optional Firebase backup with Google Sign-In

### Settings
- **Tracking mode**: Simple (daily) or AM/PM
- **Manage Symptoms**: Add, edit, reorder, hide symptoms
- **Manage Stack**: Add, edit, reorder, hide supplements
- **Backup/Restore**: JSON import/export
- **Clear Data**: Remove entries while keeping symptom/stack configuration
- **Full Reset**: Complete factory reset

## Deployment

### GitHub Pages

1. Create a new repository on GitHub

2. Upload these files to the repository:
   - `index.html`
   - `manifest.json`

3. Enable GitHub Pages:
   - Go to Settings → Pages
   - Source: Deploy from branch
   - Branch: main, / (root)
   - Save

4. Your app will be available at: `https://yourusername.github.io/repository-name/`

### Firebase Setup (Optional - for cloud sync)

1. Go to [Firebase Console](https://console.firebase.google.com/)

2. Select project `symptoms-dae26` (or create new)

3. **Enable Firestore API**:
   - Visit: https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=symptoms-dae26
   - Click "Enable"

4. **Authorize your domain**:
   - Firebase Console → Authentication → Settings → Authorized domains
   - Add your GitHub Pages domain (e.g., `yourusername.github.io`)

5. **Firestore Rules** (set in Firebase Console → Firestore → Rules):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Usage

### Logging Symptoms

1. **Tap a symptom** to open the severity picker
2. **Tap a number (0-5)** to log severity
3. **In AM/PM mode**: Toggle between Morning/Evening with the button
4. **Tap existing entry** to clear it

### Managing Supplements

1. **Tap checkbox** to mark as taken
2. **Tap dose** to edit amount
3. **Use multiplier buttons** (½×, 2×, 3×) for different doses
4. **"↩ Copy Yesterday"** copies yesterday's exact state

### Navigation

- **← →** arrows or **swipe** to change dates
- **Tap date** to open calendar picker
- **Bottom tabs**: Symptoms, Stack, Insights, Settings

### Keyboard Shortcuts (Desktop)

- **←/→**: Navigate dates
- **Escape**: Close modals

## Data Model

```javascript
// Local Storage Keys
symptomTracker_symptoms    // Symptom definitions
symptomTracker_entries     // Symptom log entries
symptomTracker_notes       // Daily notes
symptomTracker_stackItems  // Supplement definitions
symptomTracker_stackEntries // Supplement log entries
symptomTracker_mode        // 'simple' or 'ampm'
symptomTracker_pinned      // Pinned symptom IDs

// Firestore: users/{uid}
{
  symptoms: [{ id, name, active, order }],
  entries: { [key]: { date, symptomId, time, severity } },
  dailyNotes: { [date]: string },
  stackItems: [{ id, name, unit, defaultDose, active, order }],
  stackEntries: { [key]: { date, itemId, dose, taken, multiplier } },
  trackingMode: 'simple' | 'ampm',
  pinnedSymptoms: [symptomId],
  updatedAt: timestamp,
  version: '3.0'
}
```

## Technical Details

- **Framework**: React 18 (CDN)
- **Transpilation**: Babel standalone
- **Storage**: localStorage + optional Firestore
- **Auth**: Firebase Google Sign-In
- **PWA**: manifest.json for Add to Home Screen
- **Styling**: Inline styles (no CSS framework)

## Browser Support

- iOS Safari 14+
- Chrome 90+
- Firefox 90+
- Edge 90+

## Known Issues

- Console warnings about Permissions-Policy and Babel transformer are harmless
- Ad blockers may interfere with Firebase requests
- CORS errors when opening file:// directly (use a local server or deploy)

## Version History

### v3.0.4
- Symptom picker now replaces name in-place (thumb-friendly)
- Header shows "Logging {name} to AM/PM"
- Copy Yesterday copies precisely (clears today first)

### v3.0.3
- Reorganized symptom tile layout
- Pin button on left, AM/PM toggle on right

### v3.0.2
- AM/PM selection is now sticky across symptoms
- Added "Logging to AM/PM" indicator
- Removed borders from small severity badges

### v3.0.1
- Increased scroll padding for mobile
- Larger Note button (30% bigger)
- Renamed "Add Symptoms" → "Manage Symptoms"
- Renamed "Add to Stack" → "Manage Stack"

### v3.0.0
- Drag-to-reorder with ≡ handles
- Swipe-to-delete gestures
- Removed sparkline charts
- Version number in Settings

### v2.9
- Auto-sync to cloud (30-second debounce)
- Fixed full reset functionality

### v2.8
- AM/PM toggle simplified
- Copy Yesterday only copies checked items

## License

MIT License - Feel free to modify and use for personal health tracking.

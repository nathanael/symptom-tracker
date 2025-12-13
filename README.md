# Symptom Tracker v2.7

A mobile-first health tracking app for daily symptom and supplement logging.

## Features
- 2D gesture interface for quick severity logging
- AM/PM tracking mode
- Stack (supplement) tracking with multipliers
- Insights and trends visualization
- CSV export
- iCloud backup via Files app
- **Cloud Sync** via Firebase (when self-hosted)

## Deployment to GitHub Pages

### Quick Setup:

1. **Create a new GitHub repository**

2. **Upload these files to the repo:**
   - `index.html`
   - `manifest.json`

3. **Enable GitHub Pages:**
   - Go to repo Settings → Pages
   - Source: Deploy from branch
   - Branch: `main` (or `master`), folder: `/ (root)`
   - Click Save

4. **Enable Cloud Sync (Firebase):**
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Select project: `symptoms-dae26`
   - Go to Authentication → Settings → Authorized domains
   - Add: `yourusername.github.io`

5. **Access your app:**
   - `https://yourusername.github.io/repo-name/`

### Add to Home Screen (iOS):
1. Open the URL in Safari
2. Tap Share → Add to Home Screen
3. Name it "Symptoms"

## Files

| File | Purpose |
|------|---------|
| `index.html` | Complete app (single file, runs in browser) |
| `manifest.json` | PWA manifest for home screen install |
| `SymptomTracker.jsx` | Source component (for reference/editing) |

## v2.7 Changes
- Fixed AM/PM entry overwrite bug
- Added "Logging to AM/PM" indicator in quick picker
- Fixed "Copy Yesterday" for Stack (now includes unchecked items)
- Removed unreliable auto-detect (was using server timezone)

## Data Storage
- **Local**: All data saved to localStorage (works offline)
- **Cloud**: Optional Firebase sync when signed in (requires self-hosting)

## Cloud Sync Notes

Cloud sync will work on:
- ✅ GitHub Pages
- ✅ Firebase Hosting
- ✅ Vercel / Netlify
- ✅ Any custom domain
- ❌ Claude artifact preview (sandbox blocks external scripts)

Just add your domain to Firebase's authorized domains list.

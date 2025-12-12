# Symptom Tracker

A mobile-first web app for tracking daily symptoms with an intuitive press-and-drag interface.

## Features

- **Ultra-low friction logging**: Press and hold any symptom, drag to select time of day and severity, release to log
- **5 time periods**: Night, Morning, All Day, Midday, Evening
- **6 severity levels**: 0 (None) to 5 (Extreme) with color coding
- **Smart starting position**: Severity defaults based on where you tap (near top starts at 5, near bottom starts at 0)
- **Calendar navigation**: Jump to any date, see which days have entries
- **History table**: Sortable by date, symptom, time, or severity
- **CSV export**: Export data for any time range (7 days to all time)
- **Persistent storage**: All data saved to localStorage
- **Bulk symptom import**: Add multiple symptoms at once
- **Soft delete**: Hide symptoms while preserving historical data

## Demo

Visit: `https://[your-username].github.io/symptom-tracker/`

## Deployment to GitHub Pages

1. Create a new repository on GitHub
2. Upload `index.html` to the repository
3. Go to Settings → Pages
4. Set Source to "Deploy from a branch"
5. Select `main` branch and `/ (root)` folder
6. Click Save
7. Your site will be available at `https://[username].github.io/[repo-name]/`

## Usage

### Logging a symptom
1. Find the symptom in the list
2. Press and hold on the symptom
3. Drag left/right to change time of day (screen is divided into 5 zones)
4. Drag up/down to change severity (0-5)
5. Release to log

### Viewing history
- Tap "History" to see all entries in a sortable table
- Tap column headers to sort

### Exporting data
- Tap "Export" to download a CSV file
- Choose a time range

### Managing symptoms
- Tap "+ Add Symptoms" to add new ones
- You can paste a list separated by commas, tabs, or new lines
- Tap a symptom to hide it (history is preserved)

## Data Storage

All data is stored in your browser's localStorage:
- `symptomTracker_symptoms` - Your symptom list
- `symptomTracker_entries` - All logged entries

Data persists across sessions but is local to your device/browser.

## Tech Stack

- React 18 (via CDN)
- Vanilla CSS-in-JS
- No build step required
- Single HTML file deployment

## License

MIT

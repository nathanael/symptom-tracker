# Claude Code Guidelines

## Deployment

When committing changes:
1. Update version number in all three locations:
   - `package.json`
   - `src/components/Settings.jsx`
   - `src/components/QuickActionsMenu.jsx`
2. Commit and push to main
3. After every push, always run `npm run build && npm run deploy` to deploy to GitHub Pages

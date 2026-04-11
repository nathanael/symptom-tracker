# Claude Code Guidelines

## Deployment

When committing changes:
1. ALWAYS bump the version number in all three locations before every deploy:
   - `package.json`
   - `src/components/Settings.jsx`
   - `src/components/QuickActionsMenu.jsx`
2. Commit and push to main
3. After every push, always run `npm run build && npm run deploy` to deploy to GitHub Pages

Version must be bumped on every deploy, no exceptions. Do not deploy without bumping.

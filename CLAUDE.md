# Claude Code Guidelines

## Deployment

When committing changes:
1. ALWAYS bump the version number before every deploy. The version lives in one place, `package.json`; bump it with:
   ```
   npm version <x.y.z> --no-git-tag-version
   ```
   This updates `package.json` AND `package-lock.json` together (a lockfile left behind makes the next `npm install` dirty the working tree). Commit both.
   - Everything else reads it from `src/version.js` (`APP_VERSION`, imported from `package.json`): the Settings "About" line, the backup file's `version` field (`backupToFile` in `src/components/Settings.jsx`), and the menu in `src/components/QuickActionsMenu.jsx`. Do not hardcode a version string anywhere else.
2. Commit and push to main
3. After every push, always run `npm run build && npm run deploy` to deploy to GitHub Pages

Version must be bumped on every deploy, no exceptions. Do not deploy without bumping.

// Single source of truth for the app version: package.json. Bump it with
// `npm version <x.y.z> --no-git-tag-version` (keeps package-lock.json in sync).
import { version } from '../package.json';

export const APP_VERSION = version;

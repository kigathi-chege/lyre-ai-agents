# Publishing `@~lyre/ai-agents`

This package publishes to npm automatically on push to `main`, using **npm
Trusted Publishing** (OIDC) — no `NPM_TOKEN` secret required. The workflow lives
at [`.github/workflows/publish.yml`](.github/workflows/publish.yml).

It ships **built outputs** from `dist/` (`package.json` points `main`/`types` at
`dist/index.js` and `dist/index.d.ts`). The workflow builds before publishing,
and the `files` allowlist limits the tarball to `dist/`, `README.md`, and `LICENSE`.

Verify locally before publishing:

```bash
npm pack --dry-run   # prints the exact tarball contents
```

## One-time setup

### 1. Confirm scope ownership on npmjs.com

Own the `@~lyre` scope (`https://www.npmjs.com/settings/~lyre`) — the same scope
as `@~lyre/intelligence-sdk` and the other `@~lyre/*` packages.

### 2. First-time publish (bootstrap)

Trusted Publishing can only attach to a package that already exists, so do the
first publish manually:

```bash
npm login
npm publish --access public   # one time only
```

This package supersedes the older `@~lyre/ai-agents@0.1.0` that was published
from `britam-legacy`; the local version (`0.2.0`) is already higher, so the first
automated publish will go through cleanly.

### 3. Configure Trusted Publishing

On npmjs.com, open **Settings → Trusted publishers → Add publisher**:

- **Publisher**: GitHub Actions
- **Organization or user**: `kigathi-chege`
- **Repository**: `ai-agents`
- **Workflow filename**: `publish.yml`
- **Environment name**: `Home`

### 4. (Optional) Create the `Home` GitHub environment

In the repo's GitHub settings → **Environments**, create `Home` to gate publishes
behind required reviewers if you want.

## Day-to-day

1. Bump `version` in `package.json`.
2. Commit, push to `main`.
3. The workflow compares local vs npm and publishes only when they differ.
   Unchanged versions are skipped. You can also trigger it manually from the
   **Actions** tab (`workflow_dispatch`).

## Versioning

Semver. Breaking changes in `0.x` bump the minor; bug fixes bump the patch.

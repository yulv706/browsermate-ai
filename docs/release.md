# Release Checklist

This checklist prepares a BrowserMate AI release for GitHub.

## Before Release

```bash
npm run icons
npm run validate
npm run package
```

Confirm the generated archive exists:

```bash
ls dist/
```

The release archive should be named like `browsermate-ai-v0.1.0.zip`.

## Create the GitHub Repository

Create an empty public repository on GitHub, then connect this local repository:

```bash
git remote add origin https://github.com/<your-name>/browsermate-ai.git
git push -u origin main
```

If you prefer the GitHub CLI:

```bash
gh repo create <your-name>/browsermate-ai --public --source . --remote origin --push
```

## Create a Release

1. Open the repository on GitHub.
2. Go to Releases.
3. Draft a new release.
4. Use the tag `v0.1.0`.
5. Upload `dist/browsermate-ai-v0.1.0.zip`.
6. Copy the highlights from `CHANGELOG.md`.

## Store Submission Notes

For browser extension store submissions, include:

- the extension purpose from `README.md`
- permission explanations from `docs/permissions.md`
- privacy details from `PRIVACY.md`
- screenshots of the popup, options page, and in-page sidebar

Review requested permissions before every store upload.

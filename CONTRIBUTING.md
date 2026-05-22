# Contributing

Thanks for helping improve PageMate AI.

## Development Setup

1. Fork and clone the repository.
2. Install a recent Node.js runtime.
3. Run `npm run validate`.
4. Load the repository root as an unpacked extension from `chrome://extensions/`.

The extension is built with plain JavaScript, HTML, and CSS. There is no bundling step for local development.

## Pull Requests

- Keep changes focused on one feature or bug fix.
- Update `README.md`, `PRIVACY.md`, or `docs/permissions.md` when behavior or permissions change.
- Run `npm run validate` before opening a PR.
- Include screenshots or short recordings for UI changes when possible.

## Security and Privacy

Do not commit API keys, test tokens, or private endpoint URLs. If you find a security or privacy issue, please follow [SECURITY.md](SECURITY.md).

# Permissions

BrowserMate AI uses broad page access because its core feature is answering questions with the current page as context.

## `storage`

Stores user settings, including endpoint URL, API Key, model, temperature, and system prompt.

## `activeTab`

Allows the popup to operate on the currently active tab after the user clicks the extension.

## `scripting`

Allows the background service worker to inject the content script when a page did not receive it automatically or after an extension reload.

## `http://*/*` and `https://*/*`

Used for two things:

- running the content script on ordinary web pages so the sidebar can read visible text, selected text, and extracted page text
- allowing the background service worker to call a user-configured AI endpoint

The extension does not send page content automatically on page load. Page context is sent when the user asks a question, clicks a quick action, or tests the configured AI connection.

## Future Improvements

Potential future work includes optional host permissions, per-site enablement, and narrower presets for users who only want to run the extension on selected domains.

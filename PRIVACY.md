# Privacy Policy

BrowserMate AI is a local browser extension. It does not include any built-in analytics, tracking SDKs, advertising SDKs, or remote telemetry endpoints.

## Data Stored Locally

The extension stores the following settings through `chrome.storage.sync`:

- AI endpoint URL
- API Key
- model name
- temperature
- custom system prompt

These settings are stored by the browser and may sync through the user's browser account if sync is enabled.

## Data Sent to AI Services

When the user asks a question, the extension sends the request to the AI endpoint configured by the user. The request can include:

- the user's question
- current page title and URL
- selected page text
- visible page text
- extracted page text
- recent sidebar conversation history

The extension only sends this data to the endpoint configured by the user. The privacy practices of that endpoint are controlled by the selected service provider.

## Data Not Collected by This Project

This project does not collect, sell, share, or transmit data to project maintainers. It does not run a project-owned backend service.

## Recommended Usage

Do not send sensitive pages, private documents, credentials, financial records, medical records, or confidential work content to an AI provider unless you trust that provider and understand its data policy.

## Contact

Please use GitHub Issues for privacy questions or reports.

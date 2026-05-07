# Meem Browser Skill

This document describes how an agent should use the Meem browser plugin.

## Purpose

Use this skill when the user asks the agent to work with the user's current browser, current tab, or logged-in web session.

The browser plugin is different from Playwright:

- Browser plugin: operates the user's existing browser through the Meem extension.
- Playwright: starts an isolated automation browser from the local client.

Prefer the browser plugin for logged-in sites, existing tabs, admin dashboards, and tasks that depend on the user's current browser state.

## Runtime Pieces

- Extension source: `browser/extension`
- Local bridge source: `client/server/browser`
- Agent tools: `client/agents/browser`

The local bridge listens on the configured `CHROME_EXTENSION_HOST` and `CHROME_EXTENSION_PORT`.
The extension registers with the bridge and polls for commands.

## Agent Tool Policy

Use the smallest tool that can complete the task.

- Use `browser_status` first when you need current tab or connection state.
- Use `browser_eval` for read-only page inspection or small DOM operations.
- Use `browser_navigate` when the current active tab should move to a URL.
- Use `browser_open_tab` when the task should not disturb the current page.
Do not use this plugin for destructive website actions unless the user clearly requested the action.
When a task involves purchases, publishing, deleting, sending messages, or changing account settings, stop before the final irreversible step and ask for confirmation.

## Expected Flow

1. Check bridge and tab state with `browser_status`.
2. Inspect the current page with `browser_eval` when possible.
3. Navigate or open a tab only if the current context is insufficient.
4. Execute the minimal page action needed.
5. Return a concise result with the page state observed.

## Failure Handling

If the extension is not connected, tell the user to load `browser/extension` in Chrome and keep the Meem Client running.

If a command times out, retry once only when the action is idempotent. Otherwise report the timeout and current browser state.

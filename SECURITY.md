# Security Policy

## Supported versions

Only the latest release is supported. Fixes land there first.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: on this repository, go to **Security**, then **Report a vulnerability**. You should get a response within a few days.

## Security model, briefly

- The app binds to `127.0.0.1` by default and is meant to run on your own machine. If you expose it to a network (for example with `tailscale serve`), treat anyone who can reach it as trusted, and set `SE_ALLOWED_HOSTS` as described in the README.
- API keys are stored locally in the app's data folder, outside the project tree, or read from environment variables. They are only ever sent to the provider they belong to.
- Dictation audio streams from your browser directly to Deepgram using a short-lived token; it does not pass through this server.
- The experience bank and essays are plain local files. Protect them like any personal documents: whoever can read the data folder can read your stories and your keys.

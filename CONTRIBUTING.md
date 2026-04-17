# Contributing

Thanks for contributing to SeeCost Tracker.

## Before You Start

- Open an issue first for non-trivial features or behavior changes
- Keep changes scoped and reviewable
- Prefer small pull requests over large mixed changes

## Development Setup

```bash
npm install
npm test
```

The package is built into `dist/` during tests and publish flows.

## What to Contribute

Good contributions include:

- bug fixes
- support for additional provider response formats
- pricing and model alias updates
- setup improvements for supported frameworks
- docs improvements
- tests that cover real regressions

Please avoid unrelated refactors in the same pull request.

## Coding Guidelines

- Keep the SDK lightweight and dependency-conscious
- Preserve app safety: tracker failures must not break app requests
- Prefer explicit behavior over implicit magic
- Keep server-side usage assumptions clear
- Update tests whenever behavior changes

## Pull Request Checklist

- `npm test` passes
- docs are updated if the public behavior changed
- comments and messages are written in English
- no secrets, personal paths, or private infrastructure details are included

## Release Notes

Maintainers handle versioning and npm publishing unless explicitly arranged otherwise.

# Security Policy

## Supported Versions

Security fixes are applied on a best-effort basis to the latest published version of `@seecost/tracker`.

## Reporting a Vulnerability

Do not open a public GitHub issue for security-sensitive problems.

Instead, report vulnerabilities privately to the maintainers through the repository security advisory flow or the designated maintainer contact channel.

When reporting, include:

- affected package version
- runtime and framework details
- reproduction steps
- impact assessment
- any proposed mitigation if available

We will review reports as quickly as practical and coordinate disclosure after a fix is available.

## Scope Notes

This package is designed to run on the server side. Reports related to:

- API key exposure risks
- unintended client-side initialization
- request interception side effects
- ingest endpoint misuse
- provider response parsing issues

are all in scope.

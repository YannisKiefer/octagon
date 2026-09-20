# Security Policy

## Supported versions

This is an early-stage project. Only the `main` branch is supported. Security fixes land on `main`; please run the latest state of `main` if you can.

| Version | Supported |
| --- | --- |
| `main` branch | yes |
| Older commits, tags, forks | no |

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories:

https://github.com/YannisKiefer/octagon/security/advisories/new

Use the "Report a vulnerability" button on that page. Do not open a public issue for a security report.

The goal is to acknowledge reports within 7 days. This is a target, not a guarantee; the project is small and maintained in spare time.

## Scope notes

- The dashboard is meant to run locally. Do not expose it to the internet. Reports that assume a public deployment are out of scope unless the underlying issue also affects local use.
- The MCP server (`mcp/server.js`) is stdio-only by design: it has no network listener and no auth, because it is a local process talking to a local client. Do not expose it over HTTP.
- Everything the product stores lives in one local SQLite file: `infra/db/farm.db`. There is no cloud storage, no accounts, and no telemetry. Questions or reports about the data the product stores belong in this policy as well: if you believe the product records something it should not, or stores it in a way it should not, report it here.

## Safe harbor

We will consider security research conducted in good faith and in line with this policy to be authorized: we will not pursue or support legal action against anyone who reports vulnerabilities responsibly, avoids privacy violations, data destruction, and service degradation, and gives us a reasonable window to fix the issue before public disclosure.

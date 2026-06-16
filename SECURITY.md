# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✓         |
| < 0.2   | ✗         |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email: [open an issue with the label `security` and request a private discussion]

We aim to respond within 48 hours and release a patch within 7 days for confirmed vulnerabilities.

## Scope

Cortex reads your local filesystem to build a code index. It does not:
- Send any code or index data to external servers
- Execute any code from the indexed project
- Store credentials or secrets

If you find a vulnerability where Cortex could be used to exfiltrate data, execute arbitrary code, or escape its intended read-only scope, please report it.

# Security Policy

## Supported versions

Security fixes are applied to the latest published version of `ftc-toolchain` and the current `main` branch.

## Reporting a vulnerability

Please report vulnerabilities through a [private GitHub security advisory](https://github.com/Sanjit-K/ftc-toolchain/security/advisories/new). Do not open a public issue for a suspected vulnerability.

Include:

- the affected tool, version, or commit;
- the impact and conditions required to trigger it;
- minimal reproduction steps or a proof of concept;
- whether file writes, shell commands, ADB, Wi-Fi credentials, or robot deployment are involved; and
- any mitigation you have already identified.

Do not include real team credentials, student data, or destructive payloads. Use placeholder values and the smallest safe reproduction possible.

The maintainer will acknowledge a complete report when it is reviewed, investigate it, and coordinate disclosure and a fix when appropriate. Please allow time for a patch before publishing details.

## Security scope

Reports are especially useful for command injection, path traversal, unsafe file overwrite, secret exposure, malicious reference content, unintended robot deployment, insecure ADB behavior, or failure to restore the user's network after Wi-Fi switching.

General setup problems, expected AI-client behavior, and feature requests should use the normal issue templates instead.

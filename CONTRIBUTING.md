# Contributing to FTC Toolchain

Thanks for helping make AI-assisted FTC development safer and more useful. Contributions from students, mentors, alumni, and developers are welcome.

## Before you start

- Search [existing issues](https://github.com/Sanjit-K/ftc-toolchain/issues) before opening a new one.
- Use an issue template and include enough context for someone else to reproduce or evaluate the request.
- For a large feature or behavior change, open an issue before writing the implementation. This prevents duplicated work and gives maintainers a chance to confirm the direction.
- Never post Wi-Fi passwords, API keys, access tokens, student contact information, or other private team data.
- Security vulnerabilities belong in a [private security advisory](https://github.com/Sanjit-K/ftc-toolchain/security/advisories/new), not a public issue.

Small fixes, documentation improvements, and focused tests can go directly to a pull request.

## Ways to contribute

- Report a reproducible bug.
- Improve tool descriptions, examples, or troubleshooting guidance.
- Add tests for a real FTC workflow or failure mode.
- Improve macOS or Windows support.
- Improve generated Java while preserving readable, team-editable output.
- Improve the website and documentation.
- Propose a focused MCP tool that closes a real gap in the code-to-robot loop.

## Development setup

Requirements: Node.js 18 or newer and Git. Robot deployment work also needs Android platform-tools (`adb`). Full FTC builds need Android Studio or an equivalent Android SDK plus JDK 17.

```bash
git clone https://github.com/Sanjit-K/ftc-toolchain.git
cd ftc-toolchain
npm install
npm run build
npm test
```

To download the reference material used by the knowledge tools:

```bash
npm run setup
```

The main MCP server is in `src/`. Integration coverage lives in `scripts/test-client.mjs`. The website and rendered documentation are in `website/`.

## Making a change

1. Fork the repository and create a focused branch from `main`.
2. Keep the change limited to one problem or feature.
3. Match the existing TypeScript style and keep generated robot code readable by students.
4. Add or update tests when behavior changes.
5. Update the README, website, or tool descriptions when users need new instructions.
6. Run the relevant checks before opening a pull request.

For MCP server changes:

```bash
npm test
```

For website changes:

```bash
cd website
npm install
npm run build
npm run pages:build
```

Tests that require a real FTC project or robot should be clearly identified. Do not make ordinary tests depend on attached hardware, a team's Wi-Fi network, or unpublished credentials.

### Real robot testing is required

Any pull request that can affect generated robot code, Gradle, ADB, deployment, logs, project inspection, or Wi-Fi switching must pass the [real robot test policy](HARDWARE_TESTING.md) before merge. Automated tests and mocks are still required where appropriate, but they do not replace a test on a physical Robot Controller.

If you do not have access to hardware, open the pull request as a draft and mark the hardware test as pending. A maintainer or another contributor must complete and document the test before the pull request can merge. Documentation-only, website-only, and community-file changes may mark hardware testing as not applicable with an explanation.

## Pull requests

A good pull request:

- links the issue it addresses;
- explains the user-visible behavior and why it is needed;
- stays small enough to review confidently;
- includes test results and any manual verification;
- includes the required real-robot evidence for robot-facing changes;
- calls out changes involving file writes, Gradle, ADB, deployment, or Wi-Fi switching;
- includes screenshots for visible website changes; and
- contains no generated build output, secrets, robot credentials, or unrelated formatting changes.

Maintainers may ask for a smaller scope, additional tests, documentation, or changes that keep existing workflows compatible. Opening a pull request does not guarantee that the feature will be merged.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).

## Robot and field safety

Code that builds successfully can still move hardware unexpectedly. Changes that control motors, servos, ADB deployment, networking, or the Robot Controller must default to the safest practical behavior.

- Preserve dry-run and confirmation boundaries.
- Do not silently overwrite team code.
- Do not deploy or restart the Robot Controller unless the requested tool is explicitly performing that action.
- Restore the original network after automatic Wi-Fi deployment, including failure paths.
- Never test network switching or deployment during an official match.
- State clearly when verification used mocks instead of a physical robot.
- Do not merge robot-facing changes until the [hardware test record](HARDWARE_TESTING.md) is complete.

## Review and releases

Maintainers decide whether a contribution fits the project, request changes when needed, and perform npm releases. Contributors should not update the package version or publish artifacts unless a maintainer specifically asks them to.

Everyone participating in this repository must follow the [Code of Conduct](CODE_OF_CONDUCT.md). For usage questions, see [SUPPORT.md](SUPPORT.md).

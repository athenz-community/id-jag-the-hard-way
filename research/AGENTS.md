# Research Authoring Rules

These rules apply throughout `research/`. Use [README.md](./README.md) for the document template, naming, and directory structure.

## Goal

- Keep `# Goal` to one short paragraph stating the concrete purpose of the page, then proceed directly to the table of contents
- Keep verification and release notes in the verification block, and procedural explanations in the steps; do not expand the goal with callouts, lists, or a step-by-step overview

## Independent Command Blocks

- Every runnable shell block must work independently from the documented working directory after the stated prerequisites
- Define or fetch every variable and temporary input inside the block that uses it. Repeat token acquisition when necessary; do not rely on a shared variable-setup block or the same shell session
- Use fixed values inline when a variable adds no clarity. Initialize ports with `tools/port.sh` in each block that uses them
- If a check must use the same token for several requests, include issuance and those requests in one block. Use a subshell when temporary variables or shell options should not persist
- Persistent lab resources may be prerequisites or explicit setup steps. Explain each block's purpose immediately before it and keep it focused on one understandable check

## Result Blocks

- Immediately follow every runnable command block with a separate `sh` block showing its result, separated by a blank line
- Prefix every line of the result block with `#`, including status lines and JSON, so humans can compare their terminal output directly
- Include expected failures and preserve exact error `code` and `message` fields. Distinguish a test passing because rejection was expected from an unexpected failure
- Label expected examples versus captured output. Keep live verification pending until there is evidence for the exact procedure
- Show stable, relevant output. Explain omitted changing fields in prose; do not invent values or use `...` placeholders inside JWT claims
- Never include raw tokens, private keys, certificates, or other credential material in research records

## Shared Tools and Output Style

- Reuse existing operation scripts under `tools/` and inspect neighboring tools before adding a helper
- Shell tools use `tools/color.sh`: `info` (`·`), `ok` (`✔`), `warn` (`⚠`), `err` (`✘`), and `fatal` (`✘`)
- Match these status lines in result examples and preserve meaningful exit codes

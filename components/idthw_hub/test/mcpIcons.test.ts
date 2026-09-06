import assert from "node:assert/strict"
import test from "node:test"
import {
  mcpIconOptionsFromFileNames,
  normalizeMcpIconId,
  resolveMcpIconSrc,
} from "../features/mcp-servers/lib/mcpIcons.ts"

test("builds sorted icon options from supported image file IDs", () => {
  assert.deepEqual(mcpIconOptionsFromFileNames([
    "slack.png",
    "notes.md",
    "google-drive.png",
    "slack.png",
    "bad/name.png",
  ]), [
    {
      id: "google-drive.png",
      label: "Google Drive",
      src: "/mcp_icons/google-drive.png",
    },
    {
      id: "slack.png",
      label: "Slack",
      src: "/mcp_icons/slack.png",
    },
  ])
})

test("resolves only existing icon IDs and accepts legacy local paths", () => {
  const options = mcpIconOptionsFromFileNames(["confluence.png"])

  assert.equal(resolveMcpIconSrc("confluence.png", options), "/mcp_icons/confluence.png")
  assert.equal(resolveMcpIconSrc("/icons/confluence.png", options), "/mcp_icons/confluence.png")
  assert.equal(resolveMcpIconSrc("missing.png", options), undefined)
  assert.equal(resolveMcpIconSrc("https://example.test/icon.png", options), undefined)
  assert.equal(normalizeMcpIconId("/mcp_icons/confluence.png"), "confluence.png")
})

/**
 * Every loop's SKILL.md must stay portable: the file is the unit that moves
 * between runtimes, so its frontmatter keeps to the Agent Skills spec fields
 * and its body never names a specific runtime or a runtime's tool dialect.
 * This is the enforceable half of the portability promise — the other half is
 * running the same file on a second runtime, which cannot live in CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOOPS = join(ROOT, "loops");
const SPEC_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools", "user-invocable"]);
const RUNTIME_MARKERS = /\b(openclaw|claude|anthropic|lobster|mcp__|\.claude\b)/i;

for (const loop of readdirSync(LOOPS)) {
  const skillPath = join(LOOPS, loop, "SKILL.md");
  if (!existsSync(skillPath)) continue;
  const raw = readFileSync(skillPath, "utf8");

  test(`loop '${loop}' SKILL.md frontmatter keeps to Agent Skills spec fields`, () => {
    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, "must have YAML frontmatter");
    const keys = [...fm![1].matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
    for (const k of keys) assert.ok(SPEC_FIELDS.has(k), `frontmatter field '${k}' is not a spec field — put runtime specifics under metadata.<vendor>`);
    assert.ok(keys.includes("name") && keys.includes("description"), "name and description are required");
    const name = fm![1].match(/^name:\s*(\S+)/m)?.[1];
    assert.equal(name, loop, "frontmatter name must match the directory name");
  });

  test(`loop '${loop}' SKILL.md body names no runtime`, () => {
    const body = raw.replace(/^---\n[\s\S]*?\n---/, "");
    const hit = body.match(RUNTIME_MARKERS);
    assert.ok(!hit, `body mentions '${hit?.[0]}' — refer to capabilities generically so the file ports`);
  });
}

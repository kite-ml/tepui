import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCase } from "../lib/evals/index.ts";

test("passes when all expectations hold", () => {
  const r = assertCase(
    { name: "x", message: "m", expect: { contains: ["Run Count"], not_contains: ["error"], max_chars: 100 } },
    "run count is 3",
  );
  assert.equal(r.pass, true);
});
test("collects every failure, not just the first", () => {
  const r = assertCase(
    { name: "x", message: "m", expect: { contains: ["alpha"], not_contains: ["beta"], min_chars: 100 } },
    "beta only",
  );
  assert.equal(r.pass, false);
  assert.equal(r.failures.length, 3);
});
test("matches applies regexes case-insensitively across lines", () => {
  const r = assertCase({ name: "x", message: "m", expect: { matches: ["^needs:"] } }, "Draft\nNEEDS: exact number");
  assert.equal(r.pass, true);
});

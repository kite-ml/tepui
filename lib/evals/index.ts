/**
 * tepui evals — the quality gate for loop output.
 *
 * A case states what a loop's reply must and must not contain. The assertion
 * engine is pure and runtime-agnostic; how a reply is OBTAINED lives in
 * runtime/, because that is the part that differs per runtime.
 *
 * Failures are designed to feed enforcement: a loop that regresses gets its
 * schedule disabled rather than continuing to produce bad output on a timer.
 */
export type EvalCase = {
  name: string;
  message: string;                  // the instruction sent to the loop's owner
  expect?: {
    contains?: string[];            // case-insensitive substrings that must appear
    not_contains?: string[];        // substrings that must NOT appear
    matches?: string[];             // regexes that must match
    max_chars?: number;
    min_chars?: number;
  };
};

export type CaseResult = { name: string; pass: boolean; failures: string[] };

export function assertCase(c: EvalCase, reply: string): CaseResult {
  const failures: string[] = [];
  const low = reply.toLowerCase();
  const e = c.expect ?? {};
  for (const s of e.contains ?? [])
    if (!low.includes(s.toLowerCase())) failures.push(`missing required text: "${s}"`);
  for (const s of e.not_contains ?? [])
    if (low.includes(s.toLowerCase())) failures.push(`contains forbidden text: "${s}"`);
  for (const r of e.matches ?? [])
    if (!new RegExp(r, "im").test(reply)) failures.push(`does not match /${r}/`);
  if (e.max_chars && reply.length > e.max_chars) failures.push(`too long: ${reply.length} > ${e.max_chars} chars`);
  if (e.min_chars && reply.length < e.min_chars) failures.push(`too short: ${reply.length} < ${e.min_chars} chars`);
  return { name: c.name, pass: failures.length === 0, failures };
}

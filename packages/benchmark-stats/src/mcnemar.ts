export function mcnemarTable(baseline: readonly boolean[], candidate: readonly boolean[]) {
  const out = { both_pass: 0, baseline_only: 0, candidate_only: 0, both_fail: 0 };
  for (let i = 0; i < baseline.length; i += 1) {
    const b = baseline[i];
    const c = candidate[i];
    if (b && c) out.both_pass += 1;
    else if (b) out.baseline_only += 1;
    else if (c) out.candidate_only += 1;
    else out.both_fail += 1;
  }
  return out;
}

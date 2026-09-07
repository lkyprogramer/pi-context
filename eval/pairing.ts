export type Arm = "B0" | "B1" | "B2" | "B3";

export function pairOrder(seed: string): Array<["B0" | "B1", "B2"]> {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? [["B0", "B2"]] : [["B2", "B0"]] as never;
}

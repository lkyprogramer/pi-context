export function attributeFailure(reason: string): "integrity" | "quality" | "recall" | "economics" {
  if (/integrity|leak|recover/i.test(reason)) return "integrity";
  if (/quality|polarity|constraint/i.test(reason)) return "quality";
  if (/recall|silence/i.test(reason)) return "recall";
  return "economics";
}

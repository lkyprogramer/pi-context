"""UTF-8 byte-cap reference, not the TypeScript product implementation."""
def prefix(text: str, cap: int) -> str:
    if isinstance(cap, bool) or not isinstance(cap, int) or cap < 0:
        raise ValueError("cap must be a nonnegative integer")
    data = text.encode("utf-8")
    end = min(cap, len(data))
    while end > 0 and end < len(data) and (data[end] & 0xC0) == 0x80:
        end -= 1
    return data[:end].decode("utf-8")

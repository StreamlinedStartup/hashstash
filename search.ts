// Subsequence matching lets "crv" find "Code review". Exact and contiguous matches rank first.
export function fuzzyScore(name: string, query: string): number {
  name = name.toLowerCase();
  query = query.trim().toLowerCase();
  if (!query) return 0;
  if (name === query) return 0;
  const start = name.indexOf(query);
  if (start >= 0) return 1 + start;
  let cursor = 0;
  let gaps = 0;
  for (const char of query) {
    const index = name.indexOf(char, cursor);
    if (index < 0) return Infinity;
    gaps += index - cursor;
    cursor = index + 1;
  }
  return name.length + gaps + 2;
}

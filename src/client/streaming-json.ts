export function readStreamingString(raw: string, key: string): string {
  const marker = `"${key}"`;
  const keyAt = raw.indexOf(marker);
  if (keyAt === -1) return "";
  const colonAt = raw.indexOf(":", keyAt + marker.length);
  const quoteAt = raw.indexOf('"', colonAt + 1);
  if (colonAt === -1 || quoteAt === -1) return "";

  let value = "";
  for (let i = quoteAt + 1; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') return value;
    if (char !== "\\") {
      value += char;
      continue;
    }
    i += 1;
    const escaped = raw[i];
    if (escaped === undefined) return value;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "\t";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === "u") {
      const code = raw.slice(i + 1, i + 5);
      if (code.length < 4) return value;
      value += String.fromCharCode(Number.parseInt(code, 16));
      i += 4;
    } else value += escaped;
  }
  return value;
}

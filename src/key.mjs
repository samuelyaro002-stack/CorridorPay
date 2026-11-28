/**
 * Cleans up a private key pasted into a settings page: trims spaces and quotes and adds the 0x prefix.
 * Errors describe the problem without ever including the value.
 */
export function normalizeKey(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("the private key is empty");
  let k = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (/^0x/i.test(k)) k = k.slice(2);
  if (/\s/.test(k)) throw new Error("the private key contains spaces. Is this a recovery phrase? A private key is one string of 64 characters");
  if (!/^[0-9a-fA-F]+$/.test(k)) throw new Error("the private key has characters that are not 0-9 or a-f");
  if (k.length !== 64) throw new Error(`the private key has ${k.length} characters but needs exactly 64 (not counting 0x)`);
  return `0x${k.toLowerCase()}`;
}

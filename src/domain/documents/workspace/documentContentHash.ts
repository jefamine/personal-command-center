/** Hashes the exact UTF-8 text used for optimistic filesystem concurrency. */
export async function hashDocumentContent(content: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("В этой среде недоступно безопасное вычисление контрольной суммы.");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

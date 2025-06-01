/**
 * Calculate elementSize for any type - just pass your data and get a number
 */
export function calculateElementSize<T>(data: T): number {
  try {
    // Serialize the data
    const serialized = JSON.stringify(data);
    const encoded = new TextEncoder().encode(serialized);

    // Actual size + length prefix + 50% safety margin + minimum 256 bytes
    const actualSize = encoded.length + 4; // +4 for length prefix
    const withSafety = Math.ceil(actualSize * 1.5); // 50% safety margin

    return Math.max(256, withSafety); // Minimum 256 bytes
  } catch (error) {
    // If serialization fails, return a safe default
    return 1024;
  }
}

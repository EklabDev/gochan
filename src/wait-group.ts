// Worker group for managing multiple goroutines
export class WaitGroup {
  private count: number = 0;
  private promises: Promise<any>[] = [];

  // Add a goroutine to the wait group
  add(goroutinePromise: Promise<any>): void {
    this.count++;
    this.promises.push(
      goroutinePromise.finally(() => {
        this.count--;
      })
    );
  }

  // Wait for all goroutines to complete
  async wait(): Promise<any[]> {
    const results = await Promise.all(this.promises);
    this.count = 0;
    this.promises = [];
    return results;
  }

  // Get current count of active goroutines
  getCount(): number {
    return this.count;
  }
}

// src/utils/semaphore.js

/**
 * A simple counting semaphore for limiting concurrent operations.
 * Used to control how many parallel operations can run at once.
 */
export class Semaphore {
  /**
   * Creates a new Semaphore.
   * @param {number} max - Maximum number of concurrent operations allowed
   */
  constructor(max) {
    if (max < 1) {
      throw new Error('Semaphore max must be at least 1');
    }
    this.max = max;
    this.current = 0;
    this.waiting = [];
  }

  /**
   * Acquires a permit from the semaphore.
   * If no permits are available, waits until one becomes available.
   * @returns {Promise<void>}
   */
  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }

    // Wait for a permit to become available
    await new Promise(resolve => this.waiting.push(resolve));
    this.current++;
  }

  /**
   * Releases a permit back to the semaphore.
   * If there are waiting operations, the next one will be unblocked.
   */
  release() {
    this.current--;

    if (this.current < 0) {
      this.current = 0; // Safety: prevent negative count
    }

    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next();
    }
  }

  /**
   * Executes a function while holding a permit.
   * Automatically releases the permit when done.
   * @param {Function} fn - The async function to execute
   * @returns {Promise<*>} The result of the function
   */
  async withPermit(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Gets the number of currently active operations.
   * @returns {number}
   */
  getActiveCount() {
    return this.current;
  }

  /**
   * Gets the number of operations waiting for a permit.
   * @returns {number}
   */
  getWaitingCount() {
    return this.waiting.length;
  }

  /**
   * Checks if any permits are available.
   * @returns {boolean}
   */
  isAvailable() {
    return this.current < this.max;
  }
}

/**
 * A mutex (mutual exclusion lock) - a semaphore with max=1.
 * Use for protecting critical sections that can only have one operation at a time.
 */
export class Mutex extends Semaphore {
  constructor() {
    super(1);
  }

  /**
   * Alias for withPermit for mutex-like semantics.
   * @param {Function} fn - The async function to execute under the lock
   * @returns {Promise<*>} The result of the function
   */
  async withLock(fn) {
    return this.withPermit(fn);
  }
}

export default Semaphore;

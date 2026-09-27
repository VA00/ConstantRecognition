// Shortest formula first, also with many workers.
//
// Each engine call enumerates shortest first, so within one task the first
// SUCCESS is the shortest of that task. Across tasks it is not: the workers
// run levels in parallel and finish in any order, so a K=5 hit (2^log_4(pi))
// can arrive before the K=1..4 bundle reports sqrt(pi) at K=2. Ending the
// search on the first SUCCESS then returns a longer formula.
//
// The rule: a SUCCESS at level K is only a candidate. From then on tasks
// that start at level >= K are not needed (they cannot find anything
// shorter), and the search ends once no task that starts below K is queued
// or running. A shorter SUCCESS arriving meanwhile replaces the candidate.
// The queue hands out levels in increasing order, so when a candidate
// appears the lower levels are already running: the wait is short.

export class ShortestSuccess {
  /** Level of the shortest SUCCESS so far (Infinity: none yet) */
  bestK = Infinity;

  /** Record a SUCCESS at level K; true if it is the new shortest */
  offer(K: number): boolean {
    if (K >= this.bestK) return false;
    this.bestK = K;
    return true;
  }

  /** Can a task whose levels start at minK still find a shorter formula? */
  needed(minK: number): boolean {
    return minK < this.bestK;
  }

  /** The search may end: a SUCCESS is known and no task below it is queued or running */
  settled(pendingMinKs: Iterable<number>): boolean {
    if (this.bestK === Infinity) return false;
    for (const minK of pendingMinKs) if (minK < this.bestK) return false;
    return true;
  }
}

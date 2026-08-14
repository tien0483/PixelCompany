/**
 * Runs `mapper` over `items` with at most `limit` in flight at a time, returning
 * results in input order.
 *
 * `Promise.all(items.map(...))` starts everything at once. That is fine for a
 * handful of items and pathological for the workspace git paths, where each item
 * spawns git subprocesses: a board with 40 tracked cards fanned out to 120+
 * concurrent `git` invocations every poll tick, which starved the tick that
 * followed it.
 */
export async function mapWithConcurrency<TItem, TResult>(
	items: readonly TItem[],
	limit: number,
	mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
	const results = new Array<TResult>(items.length);
	if (items.length === 0) {
		return results;
	}

	const workerCount = Math.max(1, Math.min(Math.floor(limit), items.length));
	let cursor = 0;

	const runWorker = async (): Promise<void> => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			// `index < items.length` is the loop invariant, so the element is present
			// even when `noUncheckedIndexedAccess` widens the type.
			results[index] = await mapper(items[index]!, index);
		}
	};

	await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	return results;
}

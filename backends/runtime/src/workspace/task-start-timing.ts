export async function measureTaskStartSpan<T>(spanName: string, operation: () => Promise<T>): Promise<T> {
	const startedAt = performance.now();
	try {
		return await operation();
	} finally {
		const elapsedMs = Math.round(performance.now() - startedAt);
		console.log(`[kanban] task-start ${spanName} ${elapsedMs}ms`);
	}
}

export function logTaskStartSpan(spanName: string, startedAt: number): void {
	const elapsedMs = Math.round(performance.now() - startedAt);
	console.log(`[kanban] task-start ${spanName} ${elapsedMs}ms`);
}

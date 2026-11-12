import type { ForgeId } from "./catalog";

export interface ForgeOperationContext {
	forge: ForgeId;
	host: string;
	connectionId?: string;
	/** Secrets must come from the encrypted vault and never be serialized to clients. */
	credentials: Readonly<Record<string, string>>;
	accessToken: string;
}

export interface ForgeOperation<Input = unknown, Output = unknown> {
	/** Stable feature name, namespaced by forge when registered. */
	id: string;
	description: string;
	execute(context: ForgeOperationContext, input: Input): Promise<Output> | Output;
}

const OPERATION_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const operations = new Map<string, ForgeOperation<unknown, unknown>>();

function key(forge: ForgeId, operationId: string): string {
	return `${forge}:${operationId}`;
}

/** Register a capability that is not part of the common repository adapter contract. */
export function registerForgeOperation<Input, Output>(
	forge: ForgeId,
	operation: ForgeOperation<Input, Output>,
): void {
	if (!OPERATION_ID.test(operation.id)) throw new Error(`Invalid Forge operation id: ${operation.id}`);
	const operationKey = key(forge, operation.id);
	if (operations.has(operationKey)) throw new Error(`Forge operation already registered: ${operationKey}`);
	operations.set(operationKey, operation as ForgeOperation<unknown, unknown>);
}

export function hasForgeOperation(forge: ForgeId, operationId: string): boolean {
	return operations.has(key(forge, operationId));
}

export function listForgeOperations(forge: ForgeId): Pick<ForgeOperation, "id" | "description">[] {
	const prefix = `${forge}:`;
	return [...operations.entries()]
		.filter(([operationKey]) => operationKey.startsWith(prefix))
		.map(([, operation]) => ({ id: operation.id, description: operation.description }));
}

export async function runForgeOperation<Input, Output>(
	forge: ForgeId,
	operationId: string,
	context: Omit<ForgeOperationContext, "forge">,
	input: Input,
): Promise<Output> {
	const operation = operations.get(key(forge, operationId));
	if (!operation) throw new Error(`Unsupported Forge operation: ${forge}:${operationId}`);
	return await operation.execute({ ...context, forge }, input) as Output;
}

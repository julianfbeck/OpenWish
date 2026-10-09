/** Node-only test stand-ins. Production imports the workerd built-ins. */
export class WorkerEntrypoint<Env = unknown> {
  constructor(protected readonly ctx: ExecutionContext, protected readonly env: Env) {}
}

export class DurableObject<Env = unknown> {
  constructor(protected readonly ctx: DurableObjectState, protected readonly env: Env) {}
}

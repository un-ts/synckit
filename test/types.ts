export type AsyncWorkerFn<T = number> = (
  result: T,
  timeout?: number,
) => Promise<T>

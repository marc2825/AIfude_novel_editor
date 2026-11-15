export type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  reject: (reason?: unknown) => void;
  resolve: (value: Value | PromiseLike<Value>) => void;
}>;

export function createDeferred<Value>(): Deferred<Value> {
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: Value | PromiseLike<Value>) => void = () =>
    undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return Object.freeze({
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  });
}

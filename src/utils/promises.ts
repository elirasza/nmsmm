export const sequential = <T, TResult>(array: T[], callback: (item: T) => Promise<TResult>) => {
  const promise = array.reduce<Promise<TResult>>((result, item) => result.then(() => callback && callback(item)), Promise.resolve(undefined as TResult))

  return promise
}

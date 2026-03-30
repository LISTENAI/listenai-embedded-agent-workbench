declare module "vitest" {
  export interface TypeExpectation<T = unknown> {
    toMatchTypeOf<U>(): void;
  }

  export type TestEach = <T>(cases: readonly T[]) => (
    name: string,
    fn: (item: T) => any,
    timeout?: number
  ) => any;

  export interface TestFunction {
    (...args: any[]): any;
    each: TestEach;
  }

  export const describe: (...args: any[]) => any;
  export const it: TestFunction;
  export const afterEach: (...args: any[]) => any;
  export const expect: any;
  export const expectTypeOf: <T = unknown>(value?: T) => TypeExpectation<T>;
}

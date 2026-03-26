declare module "vitest" {
  export interface TypeExpectation<T = unknown> {
    toMatchTypeOf<U>(): void;
  }

  export const describe: (...args: any[]) => any;
  export const it: (...args: any[]) => any;
  export const expect: any;
  export const expectTypeOf: <T = unknown>(value?: T) => TypeExpectation<T>;
}

declare module 'cookie' {
  export function parse(
    str: string,
    options?: {
      decode?: (value: string) => string;
    }
  ): Record<string, string>;

  export function serialize(name: string, value: string, options?: Record<string, unknown>): string;

  const cookie: {
    parse: typeof parse;
    serialize: typeof serialize;
  };

  export default cookie;
}

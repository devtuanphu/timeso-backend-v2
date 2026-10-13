/**
 * StoresService is split by domain into "parts" (service-parts/*.part.ts):
 * plain classes whose methods are copied onto StoresService.prototype here.
 * The service keeps one prototype, one constructor and one DI token, so
 * callers, `jest.spyOn(StoresService.prototype, …)` and test doubles built
 * with `Object.create(StoresService.prototype)` see every method as before.
 *
 * A method name defined twice (by the service and a part, or by two parts)
 * throws at load time instead of one silently replacing the other.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function applyClassParts(target: Function, parts: Function[]): void {
  for (const part of parts) {
    for (const name of Object.getOwnPropertyNames(part.prototype)) {
      if (name === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(target.prototype, name)) {
        throw new Error(
          `${target.name}.${name} is defined twice (${part.name})`,
        );
      }
      Object.defineProperty(
        target.prototype,
        name,
        Object.getOwnPropertyDescriptor(part.prototype, name)!,
      );
    }
  }
}

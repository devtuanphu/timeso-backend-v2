import { StoresController } from '../../src/modules/stores/stores.controller';
import { StoresPayrollController } from '../../src/modules/stores/controllers/stores-payroll.controller';
import { StoresRequestsController } from '../../src/modules/stores/controllers/stores-requests.controller';
import { StoresAttendanceController } from '../../src/modules/stores/controllers/stores-attendance.controller';
import { StoresSchedulingController } from '../../src/modules/stores/controllers/stores-scheduling.controller';

/**
 * The controllers serving the `stores/...` routes that used to live in
 * StoresController, in router order. Route-metadata invariants (owner-only,
 * guards, store source) must cover every one of them.
 */
export const STORE_ROUTE_CONTROLLERS = [
  StoresRequestsController,
  StoresSchedulingController,
  StoresController,
  StoresPayrollController,
  StoresAttendanceController,
];

/** Public members only: the controllers' private fields would make the intersection `never`. */
type PublicOf<T> = { [K in keyof T]: T[K] };
export type StoreRoutes = PublicOf<StoresController> &
  PublicOf<StoresPayrollController> &
  PublicOf<StoresRequestsController> &
  PublicOf<StoresAttendanceController> &
  PublicOf<StoresSchedulingController>;

/** The controller class that declares `handler`, if any. */
export const controllerOf = (handler: string) =>
  STORE_ROUTE_CONTROLLERS.find((controller) =>
    Object.prototype.hasOwnProperty.call(controller.prototype, handler),
  );

/** `handler` as declared on its controller's prototype (route metadata lives on it). */
export const routeHandler = (handler: string): unknown =>
  (controllerOf(handler)?.prototype as Record<string, unknown> | undefined)?.[
    handler
  ];

/**
 * StoresController built from `args`, plus every split controller built from
 * the same services; each handler is answered by the controller that owns it,
 * so a test addresses the store routes as one surface, as the router does.
 */
export function buildStoreRoutes(
  ...args: ConstructorParameters<typeof StoresController>
): StoreRoutes {
  const [storesService, , , attendanceQueue, shiftEndWorkflowService] = args;
  const instances: object[] = [
    new StoresRequestsController(storesService, shiftEndWorkflowService),
    new StoresSchedulingController(storesService),
    new StoresController(...args),
    new StoresPayrollController(storesService),
    new StoresAttendanceController(
      storesService,
      shiftEndWorkflowService,
      attendanceQueue,
    ),
  ];
  return new Proxy({} as StoreRoutes, {
    get: (_target, name) => {
      for (const instance of instances) {
        const value = (instance as Record<string | symbol, unknown>)[name];
        if (typeof value === 'function') return value.bind(instance);
      }
      return undefined;
    },
  });
}

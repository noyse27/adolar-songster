// Fields requireAuth (see middleware/auth.ts) attaches to every authenticated
// request. Declared here via declaration merging instead of a custom
// `AuthenticatedRequest` subtype so route handlers can leave `req` untyped
// and keep Express 5's automatic per-route `req.params` inference (see
// RouteParameters in express-serve-static-core) instead of overriding it
// with a fixed ParamsDictionary.
declare namespace Express {
  export interface Request {
    userId?: string;
    userRole?: string;
  }
}

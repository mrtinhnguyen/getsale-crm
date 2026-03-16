import { Router } from 'express';
import type { MessagesRouterDeps } from './messages-deps';
import { registerListRoutes } from './messages-list';
import { registerSendRoutes } from './messages-send';
import { registerActionRoutes } from './messages-actions';

/** A5: Messages routes split into list, send, and actions. */
export function messagesRouter(deps: MessagesRouterDeps): Router {
  const router = Router();
  registerListRoutes(router, deps);
  registerSendRoutes(router, deps);
  registerActionRoutes(router, deps);
  return router;
}

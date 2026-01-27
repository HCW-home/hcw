import { Injectable } from '@angular/core';

export interface ActionConfig {
  route: string;
  requiresAuth: boolean;
}

const ACTION_ROUTES: Record<string, ActionConfig> = {
  'presence': { route: '/confirm-presence', requiresAuth: true },
  'join': { route: '/appointments', requiresAuth: true },
};

const DEFAULT_ACTION: ActionConfig = { route: '/home', requiresAuth: true };

@Injectable({
  providedIn: 'root'
})
export class ActionHandlerService {
  getRouteForAction(action: string | null): string {
    if (!action) {
      return DEFAULT_ACTION.route;
    }
    const config = ACTION_ROUTES[action];
    return config ? config.route : DEFAULT_ACTION.route;
  }

  isValidAction(action: string | null): boolean {
    return action !== null && action in ACTION_ROUTES;
  }

  getActionConfig(action: string | null): ActionConfig {
    if (!action) {
      return DEFAULT_ACTION;
    }
    return ACTION_ROUTES[action] || DEFAULT_ACTION;
  }
}

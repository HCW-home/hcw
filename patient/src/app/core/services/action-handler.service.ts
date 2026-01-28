import { Injectable } from '@angular/core';

export interface ActionConfig {
  route: string;
  requiresAuth: boolean;
  appendId: boolean;
}

export interface ActionParams {
  action: string | null;
  id: string | null;
  model: string | null;
}

const ACTION_ROUTES: Record<string, ActionConfig> = {
  'presence': { route: '/confirm-presence', requiresAuth: true, appendId: true },
  'join': { route: '/consultation', requiresAuth: true, appendId: true },
};

const DEFAULT_ACTION: ActionConfig = { route: '/home', requiresAuth: true, appendId: false };

@Injectable({
  providedIn: 'root'
})
export class ActionHandlerService {
  getRouteForAction(action: string | null, id: string | null = null): string {
    if (!action) {
      return DEFAULT_ACTION.route;
    }
    const config = ACTION_ROUTES[action];
    if (!config) {
      return DEFAULT_ACTION.route;
    }

    if (config.appendId && id) {
      if (action === 'join') {
        return `${config.route}/${id}/video?type=appointment`;
      }
      return `${config.route}/${id}`;
    }
    return config.route;
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

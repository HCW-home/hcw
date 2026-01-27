import { Injectable } from '@angular/core';
import { RoutePaths } from '../constants/routes';

export interface IActionConfig {
  route: string;
  requiresAuth: boolean;
}

const ACTION_ROUTES: Record<string, IActionConfig> = {
  'presence': { route: `/${RoutePaths.CONFIRM_PRESENCE}`, requiresAuth: true },
  'join': { route: `/${RoutePaths.USER}/${RoutePaths.APPOINTMENTS}`, requiresAuth: true },
};

const DEFAULT_ACTION: IActionConfig = { route: `/${RoutePaths.USER}/${RoutePaths.DASHBOARD}`, requiresAuth: true };

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
}

import { Sidebar } from '../models/sidebar';
import { RoutePaths } from './routes';

export const MenuItems: Sidebar[] = [
  {
    name: 'Dashboard',
    path: `/${RoutePaths.DASHBOARD}`,
    icon: 'users.svg',
  },
  {
    name: 'Consultations',
    path: `/${RoutePaths.CONSULTATIONS}`,
    icon: 'geo-alt-fill.svg',
  },
  {
    name: 'Test',
    path: `/${RoutePaths.TEST}`,
    icon: 'report.svg',
  },
  {
    name: 'Availability',
    path: `/${RoutePaths.AVAILABILITY}`,
    icon: 'report.svg',
  },
]

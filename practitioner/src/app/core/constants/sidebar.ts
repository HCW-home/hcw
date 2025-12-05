import { Sidebar } from '../models/sidebar';
import { RoutePaths } from './routes';

export const MenuItems: Sidebar[] = [
  {
    name: 'Dashboard',
    path: `/${RoutePaths.DASHBOARD}`,
    icon: 'dashboard.svg',
  },
  {
    name: 'Consultations',
    path: `/${RoutePaths.CONSULTATIONS}`,
    icon: 'video.svg',
  },
  {
    name: 'Test',
    path: `/${RoutePaths.TEST}`,
    icon: 'camera.svg',
  },
  {
    name: 'Availability',
    path: `/${RoutePaths.AVAILABILITY}`,
    icon: 'calendar.svg',
  },
]

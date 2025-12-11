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
    name: 'Patients',
    path: `/${RoutePaths.PATIENTS}`,
    icon: 'user.svg',
  },
  {
    name: 'Appointments',
    path: `/${RoutePaths.APPOINTMENTS}`,
    icon: 'clock.svg',
  },
  {
    name: 'Configuration',
    path: `/${RoutePaths.CONFIGURATION}`,
    icon: 'settings.svg',
  },
]

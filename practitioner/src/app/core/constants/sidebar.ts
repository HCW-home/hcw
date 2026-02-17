import { Sidebar } from '../models/sidebar';
import { RoutePaths } from './routes';

export const MenuItems: Sidebar[] = [
  {
    name: 'sidebar.dashboard',
    path: `/${RoutePaths.DASHBOARD}`,
    icon: 'dashboard.svg',
  },
  {
    name: 'sidebar.consultations',
    path: `/${RoutePaths.CONSULTATIONS}`,
    icon: 'stethoscope.svg',
  },
  {
    name: 'sidebar.patients',
    path: `/${RoutePaths.PATIENTS}`,
    icon: 'user.svg',
  },
  {
    name: 'sidebar.appointments',
    path: `/${RoutePaths.APPOINTMENTS}`,
    icon: 'clock.svg',
  },
  {
    name: 'sidebar.configuration',
    path: `/${RoutePaths.CONFIGURATION}`,
    icon: 'settings.svg',
  },
]

import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'tabs',
    pathMatch: 'full'
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./pages/onboarding/onboarding.page').then(m => m.OnboardingPage)
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage)
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.page').then(m => m.RegisterPage)
  },
  {
    path: 'tabs',
    loadChildren: () => import('./pages/tabs/tabs.routes').then(m => m.routes)
  },
  {
    path: 'doctors',
    loadComponent: () => import('./pages/doctors/doctors.page').then(m => m.DoctorsPage)
  },
  {
    path: 'doctor/:id',
    loadComponent: () => import('./pages/doctor-detail/doctor-detail.page').then(m => m.DoctorDetailPage)
  },
  {
    path: 'book-appointment',
    loadComponent: () => import('./pages/book-appointment/book-appointment.page').then(m => m.BookAppointmentPage)
  },
  {
    path: 'health-records',
    loadComponent: () => import('./pages/health-records/health-records.page').then(m => m.HealthRecordsPage)
  },
  {
    path: 'notification-settings',
    loadComponent: () => import('./pages/notification-settings/notification-settings.page').then(m => m.NotificationSettingsPage)
  }
];
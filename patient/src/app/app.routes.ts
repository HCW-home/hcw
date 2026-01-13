import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'home',
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
    path: 'forgot-password',
    loadComponent: () => import('./pages/forgot-password/forgot-password.page').then(m => m.ForgotPasswordPage)
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./pages/reset-password/reset-password.page').then(m => m.ResetPasswordPage)
  },
  {
    path: 'verify-invite',
    loadComponent: () => import('./pages/verify-invite/verify-invite.page').then(m => m.VerifyInvitePage)
  },
  {
    path: 'confirm-presence',
    loadComponent: () => import('./pages/confirm-presence/confirm-presence.page').then(m => m.ConfirmPresencePage)
  },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage)
  },
  {
    path: 'appointments',
    loadComponent: () => import('./pages/appointments/appointments.page').then(m => m.AppointmentsPage)
  },
  {
    path: 'notifications',
    loadComponent: () => import('./pages/notifications/notifications.page').then(m => m.NotificationsPage)
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile.page').then(m => m.ProfilePage)
  },
  {
    path: 'request-detail/:id',
    loadComponent: () => import('./pages/request-detail/request-detail.page').then(m => m.RequestDetailPage)
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
    path: 'new-request',
    loadComponent: () => import('./pages/new-request/new-request.page').then(m => m.NewRequestPage)
  },
  {
    path: 'health-records',
    loadComponent: () => import('./pages/health-records/health-records.page').then(m => m.HealthRecordsPage)
  },
  {
    path: 'notification-settings',
    loadComponent: () => import('./pages/notification-settings/notification-settings.page').then(m => m.NotificationSettingsPage)
  },
  {
    path: 'consultation/:id/video',
    loadComponent: () => import('./pages/video-consultation/video-consultation.page').then(m => m.VideoConsultationPage)
  },
  {
    path: 'tabs',
    loadChildren: () => import('./pages/tabs/tabs.routes').then(m => m.routes)
  }
];
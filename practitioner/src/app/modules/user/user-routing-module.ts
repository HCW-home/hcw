import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { User } from './pages/user/user';
import { RoutePaths } from '../../core/constants/routes';
import { Dashboard } from './components/dashboard/dashboard';
import { Consultations } from './components/consultations/consultations';
import { ConsultationDetail } from './components/consultation-detail/consultation-detail';
import { ConsultationForm } from './components/consultation-form/consultation-form';
import { UserProfile } from './components/user-profile/user-profile';
import { Test } from './components/test/test';
import { Patients } from './components/patients/patients';
import { PatientDetail } from './components/patient-detail/patient-detail';
import { Appointments } from './components/appointments/appointments';
import { Configuration } from './components/configuration/configuration';

const routes: Routes = [
  {
    path: '',
    component: User,
    data: { ssr: false },
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: RoutePaths.DASHBOARD,
      },
      {
        path: RoutePaths.DASHBOARD,
        pathMatch: 'full',
        component: Dashboard,
      },
      {
        path: RoutePaths.CONSULTATIONS,
        pathMatch: 'full',
        component: Consultations,
      },
      {
        path: `${RoutePaths.CONSULTATIONS}/new`,
        component: ConsultationForm,
      },
      {
        path: `${RoutePaths.CONSULTATIONS}/:id/edit`,
        component: ConsultationForm,
      },
      {
        path: RoutePaths.CONSULTATION_DETAIL,
        component: ConsultationDetail,
      },
      {
        path: RoutePaths.TEST,
        pathMatch: 'full',
        component: Test,
      },
      {
        path: RoutePaths.PROFILE,
        pathMatch: 'full',
        component: UserProfile,
      },
      {
        path: RoutePaths.PATIENTS,
        pathMatch: 'full',
        component: Patients,
      },
      {
        path: RoutePaths.PATIENT_DETAIL,
        component: PatientDetail,
      },
      {
        path: RoutePaths.APPOINTMENTS,
        pathMatch: 'full',
        component: Appointments,
      },
      {
        path: RoutePaths.CONFIGURATION,
        pathMatch: 'full',
        component: Configuration,
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserRoutingModule {}

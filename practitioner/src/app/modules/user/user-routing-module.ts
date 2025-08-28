import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { User } from './pages/user/user';
import { RoutePaths } from '../../core/constants/routes';
import { Dashboard } from './components/dashboard/dashboard';
import { Consultations } from './components/consultations/consultations';
import { Test } from './components/test/test';
import { Availability } from './components/availability/availability';

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
        path: RoutePaths.TEST,
        pathMatch: 'full',
        component: Test,
      },
      {
        path: RoutePaths.AVAILABILITY,
        pathMatch: 'full',
        component: Availability,
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserRoutingModule {}

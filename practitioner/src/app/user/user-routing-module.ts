import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {LayoutComponent} from './layout/layout';
import {ConsultationsComponent} from './consultations/consultations';
import {ConsultationRoomComponent} from './consultation-room/consultation-room';

const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      {path: '', redirectTo: 'consultations', pathMatch: 'full'},
      {path: 'consultations', component: ConsultationsComponent}
    ]
  },
  {
    path: 'consultation/:id',
    component: ConsultationRoomComponent
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserRoutingModule {
}

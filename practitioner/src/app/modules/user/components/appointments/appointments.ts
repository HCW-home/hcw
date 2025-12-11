import { Component } from '@angular/core';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';

@Component({
  selector: 'app-appointments',
  imports: [Page, Svg],
  templateUrl: './appointments.html',
  styleUrl: './appointments.scss',
})
export class Appointments {}

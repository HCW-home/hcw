import { Component } from '@angular/core';
import { Page } from '../../../../core/components/page/page';
import { Svg } from '../../../../shared/ui-components/svg/svg';

@Component({
  selector: 'app-patients',
  imports: [Page, Svg],
  templateUrl: './patients.html',
  styleUrl: './patients.scss',
})
export class Patients {}

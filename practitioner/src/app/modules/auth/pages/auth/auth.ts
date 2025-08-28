import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Svg } from '../../../../shared/ui-components/svg/svg';

@Component({
  selector: 'app-auth',
  imports: [RouterOutlet],
  templateUrl: './auth.html',
  styleUrl: './auth.scss',
})
export class Auth {}

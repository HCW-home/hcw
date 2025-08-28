import { Component, input } from '@angular/core';
import { SvgIconComponent } from 'angular-svg-icon';

@Component({
  selector: 'app-svg',
  imports: [SvgIconComponent],
  templateUrl: './svg.html',
  styleUrl: './svg.scss',
})
export class Svg {
  src = input<string>();
  svgStyle = input<Record<string, any> | null | undefined>();
}

import { Component, input } from '@angular/core';
import { Svg } from '../svg/svg';
import { NgClass } from '@angular/common';
import { Faq } from '../../models/faq';
import { Typography } from '../typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-accordion',
  imports: [Svg, NgClass, Typography],
  templateUrl: './accordion.html',
  styleUrl: './accordion.scss'
})
export class Accordion {
  entry = input<Faq>();

  toggle(entry?: Faq) {
    if (entry && entry.answer) {
      entry.isOpen = !entry.isOpen;
    }
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}

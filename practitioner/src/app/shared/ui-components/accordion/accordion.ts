import { Component, input } from '@angular/core';
import { Svg } from '../svg/svg';
import { NgClass } from '@angular/common';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Faq } from '../../models/faq';
import { Typography } from '../typography/typography';
import { TypographyTypeEnum } from '../../constants/typography';

@Component({
  selector: 'app-accordion',
  imports: [Svg, NgClass, Typography],
  templateUrl: './accordion.html',
  styleUrl: './accordion.scss',
  animations: [
    trigger('openClose', [
      state(
        'open',
        style({
          height: '*',
          opacity: 1,
          padding: '*',
        })
      ),
      state(
        'closed',
        style({
          height: '0px',
          opacity: 0,
          padding: '0px',
        })
      ),
      transition('open <=> closed', [animate('300ms ease-in-out')]),
    ]),
  ],
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

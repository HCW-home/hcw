import { Component, input } from '@angular/core';
import { TypographyType } from '../../models/typography';
import { TypographyTypeEnum } from '../../constants/typography';
import { NgClass, NgStyle, NgTemplateOutlet } from '@angular/common';

@Component({
  selector: 'app-typography',
  imports: [NgClass, NgTemplateOutlet, NgStyle],
  templateUrl: './typography.html',
  styleUrl: './typography.scss',
})
export class Typography {
  variant = input<TypographyType>();
  color = input<string>();
  fontWeight = input<number>();
  lineHeight = input<string>();
  fontSize = input<string>();
  fontStyle = input<string>();
  letterSpacing = input<string>();

  get styles(): Record<string, string> {
    const s: Record<string, any> = {};
    if (this.color) {
      s['color'] = this.color();
    }
    if (this.lineHeight) {
      s['line-height'] = this.lineHeight();
    }
    if (this.fontSize) {
      s['font-size'] = this.fontSize();
    }
    if (this.fontStyle) {
      s['font-style'] = this.fontStyle();
    }
    if (this.letterSpacing) {
      s['letter-spacing'] = this.letterSpacing();
    }
    if (this.fontWeight) {
      s['font-weight'] = this.fontWeight();
    }
    return s;
  }

  protected readonly TypographyTypeEnum = TypographyTypeEnum;
}

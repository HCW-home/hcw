import { Component, input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-link',
  imports: [NgClass],
  templateUrl: './link.html',
  styleUrl: './link.scss',
})
export class Link {
  href = input<string>();
  text = input<string>('');
  targetBlank = input<boolean>(false);
  classes = input<string>('');
}

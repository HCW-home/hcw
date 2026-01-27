import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'linkify',
  standalone: true,
})
export class LinkifyPipe implements PipeTransform {
  private urlPattern = /(https?:\/\/[^\s<]+)/g;

  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';

    const escaped = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const linked = escaped.replace(
      this.urlPattern,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: var(--primary-600); text-decoration: underline; text-decoration-color: var(--primary-300); word-break: break-all;">$1</a>'
    );

    return this.sanitizer.bypassSecurityTrustHtml(linked);
  }
}

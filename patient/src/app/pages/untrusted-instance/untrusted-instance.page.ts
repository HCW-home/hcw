import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { TranslatePipe } from '@ngx-translate/core';

type UntrustedReason =
  | 'no-signature'
  | 'malformed-signature'
  | 'host-mismatch'
  | 'expired'
  | 'invalid-signature'
  | 'identity-probe-failed'
  | 'not-hcw-backend';

@Component({
  selector: 'app-untrusted-instance',
  templateUrl: './untrusted-instance.page.html',
  styleUrls: ['./untrusted-instance.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon, TranslatePipe],
})
export class UntrustedInstancePage {
  private route = inject(ActivatedRoute);

  host = this.route.snapshot.queryParamMap.get('host') || '';
  reason = (this.route.snapshot.queryParamMap.get('reason') || 'no-signature') as UntrustedReason;

  get reasonKey(): string {
    return `untrustedInstance.reason.${this.reason}`;
  }
}

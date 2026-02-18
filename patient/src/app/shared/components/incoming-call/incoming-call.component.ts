import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { IonButton, IonIcon, IonAvatar } from '@ionic/angular/standalone';
import { IncomingCallService, IncomingCallData } from '../../../core/services/incoming-call.service';
import { TranslatePipe } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { callOutline, closeOutline } from 'ionicons/icons';

@Component({
  selector: 'app-incoming-call',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon, IonAvatar, TranslatePipe],
  templateUrl: './incoming-call.component.html',
  styleUrls: ['./incoming-call.component.scss'],
})
export class IncomingCallComponent implements OnInit, OnDestroy {
  incomingCall: IncomingCallData | null = null;
  private destroy$ = new Subject<void>();

  constructor(private incomingCallService: IncomingCallService) {
    addIcons({ callOutline, closeOutline });
  }

  ngOnInit(): void {
    this.incomingCallService.incomingCall$
      .pipe(takeUntil(this.destroy$))
      .subscribe(call => {
        this.incomingCall = call;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onAccept(): void {
    this.incomingCallService.acceptCall();
  }

  onDecline(): void {
    this.incomingCallService.dismissIncomingCall();
  }

  getInitials(name: string): string {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
}

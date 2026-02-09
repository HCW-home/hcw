import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { IncomingCallService, IncomingCallData } from '../../../core/services/incoming-call.service';
import { Button } from '../../ui-components/button/button';
import { ButtonStyleEnum, ButtonSizeEnum } from '../../constants/button';

@Component({
  selector: 'app-incoming-call',
  standalone: true,
  imports: [CommonModule, Button],
  templateUrl: './incoming-call.html',
  styleUrl: './incoming-call.scss',
})
export class IncomingCall implements OnInit, OnDestroy {
  protected readonly ButtonStyleEnum = ButtonStyleEnum;
  protected readonly ButtonSizeEnum = ButtonSizeEnum;

  incomingCall: IncomingCallData | null = null;
  private destroy$ = new Subject<void>();

  constructor(private incomingCallService: IncomingCallService) {}

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

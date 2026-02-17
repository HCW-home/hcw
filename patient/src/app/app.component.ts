import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonApp, IonRouterOutlet, NavController } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { UserWebSocketService } from './core/services/user-websocket.service';
import { IncomingCallService } from './core/services/incoming-call.service';
import { ActionHandlerService } from './core/services/action-handler.service';
import { ConsultationService } from './core/services/consultation.service';
import { IncomingCallComponent } from './shared/components/incoming-call/incoming-call.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet, IncomingCallComponent]
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private userWsService: UserWebSocketService,
    private incomingCallService: IncomingCallService,
    private actionHandler: ActionHandlerService,
    private consultationService: ConsultationService,
    private navCtrl: NavController,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.handleDeepLinks();
    this.setupWebSocketSubscriptions();

    this.authService.isAuthenticated$
      .pipe(takeUntil(this.destroy$))
      .subscribe((isAuthenticated: boolean) => {
        if (isAuthenticated) {
          this.userWsService.connect();
        } else {
          this.userWsService.disconnect();
        }
      });
  }

  private setupWebSocketSubscriptions(): void {
    this.userWsService.appointmentJoined$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        // Don't show incoming call if already on video consultation page
        if (this.router.url.includes('/video')) {
          return;
        }

        this.incomingCallService.showIncomingCall({
          callerName: event.data.user_name,
          appointmentId: event.appointment_id,
          consultationId: event.consultation_id,
        });
      });
  }

  private handleDeepLinks(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get('auth');
    const action = urlParams.get('action');
    const actionId = urlParams.get('id');
    const email = urlParams.get('email');
    const uid = urlParams.get('uid');
    const token = urlParams.get('token');

    if (action === 'verify-email' && token) {
      this.navCtrl.navigateRoot(['/verify-email'], {
        queryParams: { token }
      });
    } else if (uid && token) {
      this.navCtrl.navigateRoot(['/reset-password'], {
        queryParams: { uid, token }
      });
    } else if (authToken) {
      const queryParams: Record<string, string> = { auth: authToken };
      if (action) queryParams['action'] = action;
      if (actionId) queryParams['id'] = actionId;
      this.navCtrl.navigateRoot(['/verify-invite'], { queryParams });
    } else if (email) {
      this.navCtrl.navigateRoot(['/login'], {
        queryParams: { email, action, id: actionId }
      });
    } else if (action && actionId) {
      if (action === 'join') {
        this.consultationService.getParticipantById(Number(actionId)).subscribe({
          next: (participant) => {
            const consultation = participant.appointment.consultation;
            const consultationId = typeof consultation === 'object' ? (consultation as {id: number}).id : consultation;
            this.navCtrl.navigateRoot(
              [`/consultation/${participant.appointment.id}/video`],
              { queryParams: { type: 'appointment', consultationId } }
            );
          },
          error: () => {
            this.navCtrl.navigateRoot([`/confirm-presence/${actionId}`]);
          }
        });
      } else {
        const route = this.actionHandler.getRouteForAction(action, actionId);
        this.navCtrl.navigateRoot([route]);
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userWsService.disconnect();
  }
}

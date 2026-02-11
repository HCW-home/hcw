import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToasterContainerComponent } from './core/components/toaster-container/toaster-container.component';
import { Confirmation } from './shared/components/confirmation/confirmation';
import { Auth } from './core/services/auth';
import { UserWebSocketService } from './core/services/user-websocket.service';
import { ActionHandlerService } from './core/services/action-handler.service';
import { IncomingCallService } from './core/services/incoming-call.service';
import { BrowserNotificationService } from './core/services/browser-notification.service';
import { RoutePaths } from './core/constants/routes';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToasterContainerComponent, Confirmation],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  protected title = 'practitioner';
  private destroy$ = new Subject<void>();

  constructor(
    private authService: Auth,
    private userWsService: UserWebSocketService,
    private actionHandler: ActionHandlerService,
    private incomingCallService: IncomingCallService,
    private browserNotificationService: BrowserNotificationService,
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
          this.browserNotificationService.requestPermission();
        } else {
          this.userWsService.disconnect();
        }
      });
  }

  private setupWebSocketSubscriptions(): void {
    this.userWsService.appointmentJoined$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
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
    const id = urlParams.get('id');

    if (authToken) {
      this.router.navigate([`/${RoutePaths.VERIFY_INVITE}`], {
        queryParams: { auth: authToken, action, id }
      });
    } else if (action && this.authService.isLoggedIn()) {
      const route = this.actionHandler.getRouteForAction(action, id);
      this.router.navigateByUrl(route);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userWsService.disconnect();
  }
}

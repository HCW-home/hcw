import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonApp, IonRouterOutlet, NavController } from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { UserWebSocketService } from './core/services/user-websocket.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet]
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private userWsService: UserWebSocketService,
    private navCtrl: NavController
  ) {}

  ngOnInit(): void {
    this.handleDeepLinks();

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

  private handleDeepLinks(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get('auth');
    const action = urlParams.get('action');
    const uid = urlParams.get('uid');
    const token = urlParams.get('token');

    if (uid && token) {
      this.navCtrl.navigateRoot(['/reset-password'], {
        queryParams: { uid, token }
      });
    } else if (authToken) {
      const queryParams: { auth: string; action?: string } = { auth: authToken };
      if (action) {
        queryParams.action = action;
      }
      this.navCtrl.navigateRoot(['/verify-invite'], { queryParams });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userWsService.disconnect();
  }
}

import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToasterContainerComponent } from './core/components/toaster-container/toaster-container.component';
import { Confirmation } from './shared/components/confirmation/confirmation';
import { Auth } from './core/services/auth';
import { UserWebSocketService } from './core/services/user-websocket.service';
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
    private router: Router
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

    if (authToken) {
      this.router.navigate([`/${RoutePaths.VERIFY_INVITE}`], {
        queryParams: { auth: authToken, action }
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userWsService.disconnect();
  }
}

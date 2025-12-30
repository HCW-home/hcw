import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ToasterContainerComponent } from './core/components/toaster-container/toaster-container.component';
import { Confirmation } from './shared/components/confirmation/confirmation';
import { Auth } from './core/services/auth';
import { UserWebSocketService } from './core/services/user-websocket.service';

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
    private userWsService: UserWebSocketService
  ) {}

  ngOnInit(): void {
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userWsService.disconnect();
  }
}

import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-footer',
  imports: [CommonModule],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private userService = inject(UserService);

  footerHtml = signal<string | null>(null);

  ngOnInit(): void {
    this.userService
      .getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: user => {
          this.footerHtml.set(user?.main_organisation?.footer || null);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

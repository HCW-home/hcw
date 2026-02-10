import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil, switchMap } from 'rxjs';
import { UserService } from '../../core/services/user.service';
import { TermsService } from '../../core/services/terms.service';
import { ToasterService } from '../../core/services/toaster.service';
import { ITerm } from '../../modules/user/models/user';
import { RoutePaths } from '../../core/constants/routes';
import { Typography } from '../../shared/ui-components/typography/typography';
import { Button } from '../../shared/ui-components/button/button';
import { Loader } from '../../shared/components/loader/loader';
import { TypographyTypeEnum } from '../../shared/constants/typography';
import { ButtonTypeEnum, ButtonStyleEnum } from '../../shared/constants/button';

@Component({
  selector: 'app-cgu',
  standalone: true,
  imports: [Typography, Button, Loader],
  templateUrl: './cgu.html',
  styleUrl: './cgu.scss',
})
export class CguPage implements OnInit, OnDestroy {
  private router = inject(Router);
  private userService = inject(UserService);
  private termsService = inject(TermsService);
  private toasterService = inject(ToasterService);
  private destroy$ = new Subject<void>();

  TypographyTypeEnum = TypographyTypeEnum;
  ButtonTypeEnum = ButtonTypeEnum;
  ButtonStyleEnum = ButtonStyleEnum;

  term: ITerm | null = null;
  loading = true;
  accepting = false;

  ngOnInit(): void {
    this.loadTerm();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadTerm(): void {
    this.userService
      .getCurrentUser()
      .pipe(
        takeUntil(this.destroy$),
        switchMap(user => {
          const termId = user.main_organisation?.default_term;
          if (!termId) {
            this.router.navigate([`/${RoutePaths.USER}`]);
            throw new Error('No term required');
          }
          return this.termsService.getTerm(termId);
        })
      )
      .subscribe({
        next: term => {
          this.term = term;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toasterService.show('error', 'Failed to load terms');
        },
      });
  }

  onAccept(): void {
    if (!this.term) return;

    this.accepting = true;
    this.termsService
      .acceptTerm(this.term.id)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.userService.getCurrentUser())
      )
      .subscribe({
        next: () => {
          this.router.navigate([`/${RoutePaths.USER}`]);
        },
        error: () => {
          this.accepting = false;
          this.toasterService.show('error', 'Failed to accept terms');
        },
      });
  }
}

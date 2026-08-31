import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { map } from 'rxjs';
import { RoutePaths } from '../constants/routes';
import { ConsultationService } from './consultation.service';
import { ActiveCallService } from './active-call.service';
import { IncomingCallService } from './incoming-call.service';
import { PendingActionService } from './pending-action.service';
import { UserService } from './user.service';
import { ToasterService } from './toaster.service';
import { TranslationService } from './translation.service';
import { getAppointmentConsultationId } from '../../shared/tools/helper';

export interface IActionConfig {
  route: string;
  requiresAuth: boolean;
  appendId: boolean;
}

const ACTION_ROUTES: Record<string, IActionConfig> = {
  'presence': { route: `/${RoutePaths.CONFIRM_PRESENCE}`, requiresAuth: true, appendId: true },
  'join': { route: `/${RoutePaths.CONFIRM_PRESENCE}`, requiresAuth: true, appendId: true },
  'message': { route: `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`, requiresAuth: true, appendId: false },
  'consultation': { route: `/${RoutePaths.USER}/${RoutePaths.CONSULTATIONS}`, requiresAuth: true, appendId: true },
};

/**
 * Routes that interrupt an action instead of fulfilling it: the login page and
 * the three gates every authenticated route goes through. Reaching one of them
 * means the action is still owed to the user.
 */
const INTERRUPTING_ROUTES: string[] = [
  RoutePaths.AUTH,
  RoutePaths.CGU,
  RoutePaths.ONBOARDING,
  RoutePaths.ACTIVATE_ENCRYPTION,
];

const DEFAULT_ACTION: IActionConfig = { route: `/${RoutePaths.USER}/${RoutePaths.DASHBOARD}`, requiresAuth: true, appendId: false };

@Injectable({
  providedIn: 'root'
})
export class ActionHandlerService {
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private activeCallService = inject(ActiveCallService);
  private incomingCallService = inject(IncomingCallService);
  private pendingActionService = inject(PendingActionService);
  private userService = inject(UserService);
  private toasterService = inject(ToasterService);
  private t = inject(TranslationService);

  /**
   * Run a deep-link action (`?action=...&id=...&model=...`).
   *
   * Every entry point — root URL, login, invitation token, notification —
   * funnels here so a link behaves the same whichever door it comes through.
   * Actions that resolve to a plain route go through `getRouteForAction`; the
   * ones that need a lookup first are handled below.
   */
  handleAction(
    action: string | null,
    id: string | null,
    model: string | null = null
  ): void {
    if (action === 'join' && id) {
      this.openJoinLobby(id);
      return;
    }
    if (action === 'message' && id) {
      this.openConversation(id, model);
      return;
    }
    this.clearWhenLanded(
      this.router.navigateByUrl(this.getRouteForAction(action, id))
    );
  }

  /**
   * Replay the action of the link that brought the user here, if there is one.
   *
   * Called by every page that hands an authenticated user over to the
   * application — login, OpenID callback, terms, onboarding, encryption
   * activation — so the link survives however many steps stand between it and
   * its destination. Returns false when nothing was pending, leaving the
   * caller free to go to its own default page.
   */
  runPendingAction(): boolean {
    const pending = this.pendingActionService.peek();
    if (!pending) {
      return false;
    }

    this.handleAction(pending.action, pending.id, pending.model);
    if (pending.email) {
      this.warnOnRecipientMismatch(pending.email);
    }
    return true;
  }

  /** Tell the user when the link they followed was addressed to someone else. */
  warnOnRecipientMismatch(email: string): void {
    this.userService.getCurrentUser().subscribe({
      next: user => {
        if (!user?.email || user.email.toLowerCase() === email.toLowerCase()) {
          return;
        }
        this.toasterService.show(
          'warning',
          this.t.instant('header.emailMismatch'),
          this.t.instant('header.emailMismatchMessage', { email })
        );
      },
      error: () => undefined,
    });
  }

  getRouteForAction(action: string | null, id: string | null = null): string {
    if (!action) {
      return DEFAULT_ACTION.route;
    }
    const config = ACTION_ROUTES[action];
    if (!config) {
      return DEFAULT_ACTION.route;
    }

    if (config.appendId && id) {
      return `${config.route}/${id}`;
    }
    return config.route;
  }

  /**
   * Open the pre-join lobby of an invitation link (`?action=join&id=<participant>`).
   *
   * The call is started from the participant alone. Routing to the consultation
   * page and waiting for its appointment panel to hold the row made the link
   * depend on which tab and which page that panel had loaded, so a past — or
   * simply paginated-out — appointment dropped the user on the consultation
   * instead of the call. The page is still opened behind the lobby so leaving
   * the call lands somewhere useful.
   *
   * `can_join` is the server's answer to "may I enter?"; when it says no the
   * link degrades to the presence page, which explains the situation.
   */
  openJoinLobby(participantId: string): void {
    this.consultationService.getParticipantById(participantId).subscribe({
      next: participant => {
        const appointment = participant.appointment;
        if (!appointment || appointment.can_join === false) {
          this.clearWhenLanded(
            this.router.navigate(['/', RoutePaths.CONFIRM_PRESENCE, participantId])
          );
          return;
        }

        const consultationId = getAppointmentConsultationId(appointment);
        const target = consultationId
          ? ['/', RoutePaths.USER, RoutePaths.CONSULTATIONS, consultationId]
          : ['/', RoutePaths.USER, RoutePaths.APPOINTMENTS];

        this.clearWhenLanded(
          this.router.navigate(target, { queryParams: { appointmentId: appointment.id } })
        ).then(landed => {
          // A gate sent the user to the terms, onboarding or encryption page:
          // starting the call now would ring behind a page they cannot leave,
          // and the action is still stored for that page to replay.
          if (!landed) {
            return;
          }
          this.activeCallService.startCall({
            appointmentId: appointment.id,
            consultationId: consultationId ?? undefined,
          });
          this.incomingCallService.setActiveCall(appointment.id);
        });
      },
      error: () => {
        this.clearWhenLanded(
          this.router.navigate(['/', RoutePaths.CONFIRM_PRESENCE, participantId])
        );
      },
    });
  }

  /**
   * Open the consultation a `message` link points at.
   *
   * The id in such a link is the message — or, for older notifications, the
   * participant — not the consultation, so it has to be resolved before there
   * is anything to open. Without that step the link only ever reached the
   * consultation list.
   */
  private openConversation(id: string, model: string | null): void {
    const consultation$ =
      model === 'consultations.Participant'
        ? this.consultationService
            .getParticipantById(id)
            .pipe(map(p => getAppointmentConsultationId(p.appointment)))
        : this.consultationService
            .getMessageById(id)
            .pipe(map(message => message.consultation ?? null));

    consultation$.subscribe({
      next: consultationId => {
        if (consultationId) {
          this.clearWhenLanded(
            this.router.navigate([
              '/',
              RoutePaths.USER,
              RoutePaths.CONSULTATIONS,
              consultationId,
            ])
          );
        } else {
          this.clearWhenLanded(
            this.router.navigate(['/', RoutePaths.USER, RoutePaths.CONSULTATIONS])
          );
        }
      },
      error: () => {
        this.clearWhenLanded(
          this.router.navigate(['/', RoutePaths.USER, RoutePaths.CONSULTATIONS])
        );
      },
    });
  }

  /**
   * Forget the stored action once its destination is actually reached.
   *
   * Two things can stand in the way. A `canMatch` guard — the one asking for a
   * token — cancels the navigation, which resolves to false. A `canActivate`
   * guard returning a UrlTree instead hands the pending promise over to the
   * redirect, so the promise still resolves to true while the user is left on
   * the terms, onboarding or encryption page; only the URL tells that apart.
   * In both cases the action stays stored, which is what lets the page that
   * finally clears the way replay it.
   */
  private clearWhenLanded(navigation: Promise<boolean>): Promise<boolean> {
    return navigation.then(navigated => {
      const landed = navigated && !this.isOnInterruptingRoute();
      if (landed) {
        this.pendingActionService.clear();
      }
      return landed;
    });
  }

  private isOnInterruptingRoute(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return INTERRUPTING_ROUTES.some(
      route => path === `/${route}` || path.startsWith(`/${route}/`)
    );
  }
}

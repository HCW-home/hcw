import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular/standalone';
import { AuthService } from './auth.service';
import { ConsultationService } from './consultation.service';
import { PendingActionService } from './pending-action.service';
import {
  Appointment,
  IParticipantDetail,
  isJoinableAppointmentStatus,
} from '../models/consultation.model';

export interface ActionConfig {
  route: string;
  requiresAuth: boolean;
  appendId: boolean;
  idAsQueryParam?: string;
}

export interface ActionRoute {
  path: string;
  queryParams?: Record<string, string>;
}

/** How the target page replaces the current one. */
export type ActionNavigationMode = 'root' | 'forward';

const ACTION_ROUTES: Record<string, ActionConfig> = {
  'presence': { route: '/confirm-presence', requiresAuth: true, appendId: true },
  'join': { route: '/confirm-presence', requiresAuth: true, appendId: true },
  'message': { route: '/home', requiresAuth: true, appendId: false },
  'consultation': { route: '/home', requiresAuth: true, appendId: false, idAsQueryParam: 'openChat' },
  'completeBooking': { route: '/new-request', requiresAuth: true, appendId: false },
};

const DEFAULT_ACTION: ActionConfig = { route: '/home', requiresAuth: true, appendId: false };

/**
 * Routes that interrupt an action instead of fulfilling it: the pages asking
 * the user to authenticate, and the three gates every private route goes
 * through. Reaching one of them means the action is still owed to the user.
 */
const INTERRUPTING_ROUTES: string[] = [
  '/login',
  '/register',
  '/verify-invite',
  '/terms',
  '/onboarding',
  '/activate-encryption',
];

@Injectable({
  providedIn: 'root'
})
export class ActionHandlerService {
  private navCtrl = inject(NavController);
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private authService = inject(AuthService);
  private pendingActionService = inject(PendingActionService);

  private getRouteWithParams(action: string | null, id: string | null = null): ActionRoute {
    if (!action) {
      return { path: DEFAULT_ACTION.route };
    }
    const config = ACTION_ROUTES[action];
    if (!config) {
      return { path: DEFAULT_ACTION.route };
    }

    if (config.appendId && id) {
      return { path: `${config.route}/${id}` };
    }
    if (config.idAsQueryParam && id) {
      return { path: config.route, queryParams: { [config.idAsQueryParam]: id } };
    }
    return { path: config.route };
  }

  /**
   * Replay the action of the link that brought the user here, if there is one.
   *
   * Called by every page that hands an authenticated user over to the
   * application — login, invitation code, terms, onboarding, encryption
   * activation — so the link survives however many steps stand between it and
   * its destination. Returns false when nothing was pending, leaving the
   * caller free to go to its own default page.
   */
  runPendingAction(mode: ActionNavigationMode = 'root'): boolean {
    const pending = this.pendingActionService.peek();
    if (!pending) {
      return false;
    }
    this.navigateToAction(pending.action, pending.id, mode);
    return true;
  }

  /**
   * Send the user to the destination of a deep link or notification action.
   *
   * Invitation links open the pre-join lobby as soon as the call can be
   * joined, so the patient never has to cross an intermediate page to enter a
   * meeting that is waiting for them. A `join` link is only ever sent for a
   * running or imminent meeting; a `presence` link is sent well in advance, so
   * it keeps asking for a presence confirmation until the appointment enters
   * its early-join window.
   */
  navigateToAction(
    action: string | null,
    id: string | null,
    mode: ActionNavigationMode = 'root',
  ): void {
    if ((action === 'join' || action === 'presence') && id) {
      this.consultationService.getParticipantById(Number(id)).subscribe({
        next: (participant) => this.navigateToInvitation(action, participant, id, mode),
        error: () => this.navigate(`/confirm-presence/${id}`, undefined, mode),
      });
      return;
    }

    // A `message` link carries the message, not the conversation: resolve it so
    // the chat actually opens instead of just landing on the dashboard.
    if (action === 'message' && id) {
      this.consultationService.getMessageById(Number(id)).subscribe({
        next: (message) =>
          this.navigate(
            '/home',
            message.consultation
              ? { openChat: String(message.consultation) }
              : undefined,
            mode,
          ),
        error: () => this.navigate('/home', undefined, mode),
      });
      return;
    }

    const actionRoute = this.getRouteWithParams(action, id);
    this.navigate(actionRoute.path, actionRoute.queryParams, mode);
  }

  private navigateToInvitation(
    action: string,
    participant: IParticipantDetail,
    participantId: string,
    mode: ActionNavigationMode,
  ): void {
    const appointment = participant.appointment;
    // can_join is the server's own answer — it also covers a closed
    // consultation and a roster the patient is no longer on. Older payloads
    // without the flag fall back to the status rule.
    const reachable = appointment
      ? appointment.can_join ?? isJoinableAppointmentStatus(appointment.status)
      : false;
    const canJoin =
      reachable && (action === 'join' || this.isJoinable(appointment!));

    if (!canJoin) {
      this.navigate(`/confirm-presence/${participantId}`, undefined, mode);
      return;
    }

    // The detail endpoint nests the consultation, but older payloads expose it
    // as a bare id, and an appointment can have none at all.
    const consultation: unknown = appointment.consultation;
    const consultationId =
      consultation && typeof consultation === 'object'
        ? (consultation as { id: number }).id
        : (consultation as number | null);

    if (consultationId) {
      this.navigate(
        `/consultation/${consultationId}/video`,
        { appointmentId: String(appointment.id) },
        mode,
      );
    } else {
      this.navigate(`/consultation/${appointment.id}/video`, undefined, mode);
    }
  }

  /**
   * Tell whether the appointment has entered the window the backend accepts a
   * join in, so we don't drop the patient into a lobby that would refuse them.
   * Without the config, stay on the safe side and keep the confirmation page.
   */
  private isJoinable(appointment: Appointment): boolean {
    const scheduledAt = Date.parse(appointment.scheduled_at);
    if (Number.isNaN(scheduledAt)) {
      return false;
    }
    const earlyJoinMinutes = Number(
      this.authService.getConfigSnapshot()?.appointment_early_join_minutes,
    );
    if (!Number.isFinite(earlyJoinMinutes)) {
      return false;
    }
    return Date.now() >= scheduledAt - earlyJoinMinutes * 60_000;
  }

  private navigate(
    path: string,
    queryParams: Record<string, string> | undefined,
    mode: ActionNavigationMode,
  ): void {
    const navigation =
      mode === 'forward'
        ? this.navCtrl.navigateForward(path, { queryParams })
        : this.navCtrl.navigateRoot(path, { queryParams });
    navigation.then(navigated => this.clearWhenLanded(navigated));
  }

  /**
   * Forget the stored action once its destination is actually reached.
   *
   * A guard that turns the user back cancels the navigation, but one answering
   * with a UrlTree hands the pending promise over to its own redirect, so the
   * promise still resolves to true while the user is left on a gate; only the
   * URL tells that apart. Either way the action stays stored, which is what
   * lets the page that finally clears the way replay it.
   */
  private clearWhenLanded(navigated: boolean): void {
    const path = this.router.url.split(/[?#]/)[0];
    const interrupted = INTERRUPTING_ROUTES.some(
      route => path === route || path.startsWith(`${route}/`),
    );
    if (navigated && !interrupted) {
      this.pendingActionService.clear();
    }
  }
}

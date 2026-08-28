import { inject, Injectable } from '@angular/core';
import { NavController } from '@ionic/angular/standalone';
import { AuthService } from './auth.service';
import { ConsultationService } from './consultation.service';
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

@Injectable({
  providedIn: 'root'
})
export class ActionHandlerService {
  private navCtrl = inject(NavController);
  private consultationService = inject(ConsultationService);
  private authService = inject(AuthService);

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
    const canJoin =
      appointment &&
      isJoinableAppointmentStatus(appointment.status) &&
      (action === 'join' || this.isJoinable(appointment));

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
    if (mode === 'forward') {
      this.navCtrl.navigateForward(path, { queryParams });
    } else {
      this.navCtrl.navigateRoot(path, { queryParams });
    }
  }
}

import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { map } from 'rxjs';
import { RoutePaths } from '../constants/routes';
import { ConsultationService } from './consultation.service';
import { ActiveCallService } from './active-call.service';
import { IncomingCallService } from './incoming-call.service';
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

const DEFAULT_ACTION: IActionConfig = { route: `/${RoutePaths.USER}/${RoutePaths.DASHBOARD}`, requiresAuth: true, appendId: false };

@Injectable({
  providedIn: 'root'
})
export class ActionHandlerService {
  private router = inject(Router);
  private consultationService = inject(ConsultationService);
  private activeCallService = inject(ActiveCallService);
  private incomingCallService = inject(IncomingCallService);

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
    this.router.navigateByUrl(this.getRouteForAction(action, id));
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
          this.router.navigate(['/', RoutePaths.CONFIRM_PRESENCE, participantId]);
          return;
        }

        const consultationId = getAppointmentConsultationId(appointment);
        const target = consultationId
          ? ['/', RoutePaths.USER, RoutePaths.CONSULTATIONS, consultationId]
          : ['/', RoutePaths.USER, RoutePaths.APPOINTMENTS];

        this.router
          .navigate(target, { queryParams: { appointmentId: appointment.id } })
          .then(() => {
            this.activeCallService.startCall({
              appointmentId: appointment.id,
              consultationId: consultationId ?? undefined,
            });
            this.incomingCallService.setActiveCall(appointment.id);
          });
      },
      error: () => {
        this.router.navigate(['/', RoutePaths.CONFIRM_PRESENCE, participantId]);
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
          this.router.navigate([
            '/',
            RoutePaths.USER,
            RoutePaths.CONSULTATIONS,
            consultationId,
          ]);
        } else {
          this.router.navigate(['/', RoutePaths.USER, RoutePaths.CONSULTATIONS]);
        }
      },
      error: () => {
        this.router.navigate(['/', RoutePaths.USER, RoutePaths.CONSULTATIONS]);
      },
    });
  }
}

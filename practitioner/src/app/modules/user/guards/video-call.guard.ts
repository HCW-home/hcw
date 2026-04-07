import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { ActiveCallService } from '../../../core/services/active-call.service';
import { ConfirmationService } from '../../../core/services/confirmation.service';
import { TranslationService } from '../../../core/services/translation.service';

export const canDeactivateVideoCall: CanDeactivateFn<unknown> = () => {
  const activeCallService = inject(ActiveCallService);

  // If not in a video call, allow navigation
  if (!activeCallService.hasActiveCall) {
    return true;
  }

  // If in PiP mode, allow navigation (call persists)
  if (!activeCallService.isFullscreen()) {
    return true;
  }

  // If in fullscreen call, minimize to PiP and allow navigation
  activeCallService.minimize();
  return true;
};

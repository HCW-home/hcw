import { ITemporaryParticipant } from '../../core/models/consultation';
import { IUser } from '../../modules/user/models/user';

/**
 * How a temporary contact created from the picker will be reached: an access
 * link sent by e-mail, sent by SMS/WhatsApp, or handed over manually by the
 * practitioner.
 */
export type ContactChannel = 'email' | 'sms' | 'manual';

/** An existing account picked from the search results. */
export interface ContactSelectionUser {
  kind: 'user';
  user: IUser;
}

/** A temporary contact described inline, ready to be posted to the backend. */
export interface ContactSelectionGuest {
  kind: 'guest';
  channel: ContactChannel;
  guest: ITemporaryParticipant;
}

/** What the picker currently holds. */
export type ContactSelection = ContactSelectionUser | ContactSelectionGuest;

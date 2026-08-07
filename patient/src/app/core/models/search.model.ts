import { Slot } from './consultation.model';

// Shapes served by the /map/ directory endpoint. They are flatter than the
// regular Doctor/Organisation models: the endpoint only exposes what the public
// practitioner search needs, and it identifies practitioners by `pk`.

export interface SearchOrganisation {
  id: number;
  name: string;
  location: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  logo_color: string | null;
}

export interface SearchDoctor {
  pk: number;
  first_name: string;
  last_name: string;
  email?: string;
  job_title?: string;
  picture?: string;
  location?: string | null;
  specialities?: { id: number; name: string }[];
  main_organisation?: SearchOrganisation;
}

// Practitioners and organisations rendered through the same card.
export interface SearchItem {
  type: 'organisation' | 'doctor';
  id: string;
  name: string;
  subtitle: string;
  specialities: string;
  location: string | null;
  logo: string | null;
  initials: string;
  org?: SearchOrganisation;
  doctor?: SearchDoctor;
}

export interface SearchQuery {
  who: string;
  where: string;
  // Only keep practitioners with online booking open.
  hasSlots?: boolean;
  limit?: number;
}

// Availability of one practitioner, grouped by day so a card can page through
// the dates one at a time.
export interface DoctorSlots {
  reasonId: number | null;
  specialityId: number | null;
  dates: string[];
  slotsByDate: Record<string, Slot[]>;
}

// What a result card hands back when the patient starts a booking: the
// speciality is the one the displayed slots belong to.
export interface BookingIntent {
  item: SearchItem;
  specialityId: number | null;
  slot: Slot | null;
}

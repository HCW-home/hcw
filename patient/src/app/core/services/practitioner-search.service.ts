import { Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { ApiService } from './api.service';
import { DoctorService, Reason } from './doctor.service';
import { Slot } from '../models/consultation.model';
import {
  DoctorSlots,
  SearchDoctor,
  SearchItem,
  SearchOrganisation,
  SearchQuery,
} from '../models/search.model';

const EMPTY_SLOTS: DoctorSlots = {
  reasonId: null,
  specialityId: null,
  dates: [],
  slotsByDate: {},
};

/**
 * Practitioner / organisation directory search, shared by the map page and the
 * booking wizard so both hit the same endpoint and render the same items.
 */
@Injectable({
  providedIn: 'root'
})
export class PractitionerSearchService {
  // Every result card asks for the reasons of the same handful of specialities;
  // they barely change during a session, so one round trip each is enough.
  private reasonsCache = new Map<number, Reason[]>();

  constructor(
    private api: ApiService,
    private doctorService: DoctorService,
  ) {}

  search(query: SearchQuery): Observable<SearchItem[]> {
    const params: Record<string, unknown> = { limit: query.limit ?? 50 };
    const who = query.who.trim();
    const where = query.where.trim();
    if (who) {
      params['search'] = who;
    }
    if (where) {
      params['location'] = where;
    }
    if (query.hasSlots) {
      params['has_slots'] = true;
    }

    return this.api
      .get<{ organisations: SearchOrganisation[]; practitioners: SearchDoctor[] }>('/map/', params)
      .pipe(map(response => this.buildItems(response?.organisations, response?.practitioners)));
  }

  buildItems(orgs: SearchOrganisation[] = [], docs: SearchDoctor[] = []): SearchItem[] {
    const items: SearchItem[] = [];

    for (const org of orgs) {
      items.push({
        type: 'organisation',
        id: `org-${org.id}`,
        name: org.name,
        subtitle: this.formatAddress(org),
        specialities: '',
        location: org.location,
        logo: org.logo_color,
        initials: org.name.charAt(0).toUpperCase(),
        org,
      });
    }

    for (const doc of docs) {
      const org = doc.main_organisation;
      items.push({
        type: 'doctor',
        id: `doc-${doc.pk}`,
        name: `${doc.first_name} ${doc.last_name}`,
        subtitle: org ? [org.name, this.formatAddress(org)].filter(Boolean).join(' - ') : '',
        specialities: doc.specialities?.map(s => s.name).join(', ') || '',
        location: doc.location || org?.location || null,
        logo: doc.picture || null,
        initials: `${doc.first_name.charAt(0)}${doc.last_name.charAt(0)}`.toUpperCase(),
        doctor: doc,
      });
    }

    return items;
  }

  formatAddress(org: SearchOrganisation): string {
    return [org.street, org.postal_code, org.city, org.country].filter(Boolean).join(', ');
  }

  parseLocation(location: string | null): { lat: number; lng: number } | null {
    if (!location) return null;
    const parts = location.split(',');
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  /**
   * Next available slots of a practitioner, taken from their shortest reason so
   * the card advertises the densest agenda. Never errors: an unreachable agenda
   * simply reads as "no availability".
   */
  loadSlots(item: SearchItem): Observable<DoctorSlots> {
    const doctor = item.doctor;
    const specialityIds = doctor?.specialities?.map(s => s.id) ?? [];
    if (!doctor || specialityIds.length === 0) {
      return of(EMPTY_SLOTS);
    }

    return forkJoin(specialityIds.map(id => this.getReasons(id))).pipe(
      switchMap(reasonLists => {
        const reasons = new Map<number, Reason>();
        const reasonToSpeciality = new Map<number, number>();
        reasonLists.forEach((list, index) => {
          for (const reason of list) {
            reasons.set(reason.id, reason);
            if (!reasonToSpeciality.has(reason.id)) {
              reasonToSpeciality.set(reason.id, specialityIds[index]);
            }
          }
        });

        if (reasons.size === 0) {
          return of(EMPTY_SLOTS);
        }

        const shortest = Array.from(reasons.values())
          .reduce((best, current) => (current.duration < best.duration ? current : best));
        const specialityId = reasonToSpeciality.get(shortest.id) ?? specialityIds[0];

        return this.doctorService.getAvailableSlots(shortest.id, { user_id: doctor.pk }).pipe(
          catchError(() => of([] as Slot[])),
          map(slots => {
            const slotsByDate: Record<string, Slot[]> = {};
            for (const slot of slots) {
              (slotsByDate[slot.date] ??= []).push(slot);
            }
            return {
              reasonId: shortest.id,
              specialityId,
              dates: Object.keys(slotsByDate).sort(),
              slotsByDate,
            };
          }),
        );
      }),
      catchError(() => of(EMPTY_SLOTS)),
    );
  }

  private getReasons(specialityId: number): Observable<Reason[]> {
    const cached = this.reasonsCache.get(specialityId);
    if (cached) {
      return of(cached);
    }
    return this.doctorService.getReasonsBySpeciality(specialityId).pipe(
      map(reasons => {
        this.reasonsCache.set(specialityId, reasons);
        return reasons;
      }),
      catchError(() => of([] as Reason[])),
    );
  }
}
